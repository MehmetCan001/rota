/* Rota veri katmanı: yerel öncelikli belge deposu + Supabase eşitlemesi.
   - Bütün belgeler bellekte tutulur ve kullanıcı başına IndexedDB'ye yazılır (açılış anında, çevrimdışı tam çalışır).
   - Her yazma önce yerelde uygulanır, sonra kalıcı bir giden kutusuna (outbox) eklenir ve sırayla sunucuya gönderilir.
   - Sunucu verisi kazanır; bekleyen yazması olan belgeler hariç.
   API yüzeyi claude.ai db yeteneğiyle aynıdır: RotaDB.collection(...) / RotaDB.doc('kol/id'). */
(() => {
'use strict';

const PAGE = 1000, BATCH = 200, MAX_BACKOFF = 60000, PULL_GAP = 20000;
const COL_RE = /^[a-z][a-z0-9_-]{0,40}$/;
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains']);
const META = Object.freeze({fromCache: false, hasPendingWrites: false});

const dbErr = (code, message) => Object.assign(new Error(message), {code});

/* ---------- durum ---------- */
let client = null, uid = null, adapter = null;
let store = new Map();            // 'kol/id' -> {col, id, data (dondurulmuş), ts, snap}
let outbox = [];                  // [{seq, key, col, id, op: 'put'|'del', data}]
let seqN = 0, ctr = 0;
const touched = new Map();        // anahtar -> son yerel yazma / onay / canlı olay sayacı
const ackTs = new Map();          // anahtar -> onaylanan son yazmamızın sunucu zamanı (ms); daha eski canlı olay yok sayılır
const tomb = new Map();           // anahtar -> silme onayından sonra geç gelen ekleme/güncelleme olaylarını yok sayma süresi sonu
const inflight = new Set();       // gönderimdeki op seq'leri
let meta = {};
let ready = false, readyResolve, readyP, loadedP = Promise.resolve();
let netDown = false, lastError = null, rtUp = false, rtEver = false, channel = null;
let flushP = null, flushAgain = false, flushTimer = 0, backoff = 0, maxBatch = BATCH;
let pullP = null, pullAgain = false, lastPullAt = 0, pullRetryT = 0, pullBackoff = 0;
const listeners = new Set();
const statusCbs = new Set();
const resetReady = () => { ready = false; readyP = new Promise(r => { readyResolve = r; }); };
resetReady();

/* ---------- yardımcılar ---------- */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
// Gövdeyi düz JSON'a indirger ve doğrular.
function clean(data) {
  if (!isObj(data)) throw dbErr('invalid_argument', 'Belge gövdesi bir nesne olmalı.');
  let s;
  try { s = JSON.stringify(data); } catch (e) { throw dbErr('invalid_argument', 'Belge JSON olarak yazılamıyor.'); }
  if (s.length > 256 * 1024) throw dbErr('invalid_argument', 'Belge 256 KiB sınırını aşıyor.');
  return JSON.parse(s);
}
// İç içe nesneler birleşir; diziler ve diğer değerler olduğu gibi değişir.
function merge(base, patch) {
  const out = {...base};
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}
function newId() {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ABC[x & 63];
  return s;
}
function tsMs(s) {
  if (!s) return NaN;
  return Date.parse(String(s).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
}
const later = fn => setTimeout(fn, 0);

/* ---------- anlık görüntüler ---------- */
const entry = (col, id, data, ts) => ({col, id, data, ts: ts || null, snap: null});
function docSnap(e) {
  if (!e.snap) { const d = e.data; e.snap = Object.freeze({id: e.id, exists: true, data: () => d, metadata: META}); }
  return e.snap;
}
const missing = id => Object.freeze({id, exists: false, data: () => undefined, metadata: META});
function querySnap(list, prev) {
  const docs = Object.freeze(list);
  return Object.freeze({docs, size: docs.length, empty: !docs.length, metadata: META, docChanges() {
    const out = [], old = new Map((prev || []).map((s, i) => [s.id, [s, i]]));
    docs.forEach((s, i) => {
      const o = old.get(s.id);
      if (!o) out.push({type: 'added', doc: s, oldIndex: -1, newIndex: i});
      else { if (o[0] !== s || o[1] !== i) out.push({type: 'modified', doc: s, oldIndex: o[1], newIndex: i}); old.delete(s.id); }
    });
    for (const [s, i] of old.values()) out.push({type: 'removed', doc: s, oldIndex: i, newIndex: -1});
    return out;
  }});
}

/* ---------- sorgu ---------- */
const typeRank = v => v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : 4;
function cmp(x, y) {
  const a = typeRank(x), b = typeRank(y);
  if (a !== b) return a - b;
  if (a === 4) return 0;
  return x < y ? -1 : x > y ? 1 : 0;
}
function test(v, op, w) {
  switch (op) {
    case '==': return v !== undefined && deepEqual(v, w);
    case '!=': return v !== undefined && !deepEqual(v, w);
    case '<': return v !== undefined && typeRank(v) === typeRank(w) && cmp(v, w) < 0;
    case '<=': return v !== undefined && typeRank(v) === typeRank(w) && cmp(v, w) <= 0;
    case '>': return v !== undefined && typeRank(v) === typeRank(w) && cmp(v, w) > 0;
    case '>=': return v !== undefined && typeRank(v) === typeRank(w) && cmp(v, w) >= 0;
    case 'in': return v !== undefined && Array.isArray(w) && w.some(x => deepEqual(v, x));
    case 'not-in': return v !== undefined && Array.isArray(w) && !w.some(x => deepEqual(v, x));
    case 'array-contains': return Array.isArray(v) && v.some(x => deepEqual(x, w));
  }
  return false;
}
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function run(col, filters, order, lim) {
  let out = [];
  for (const e of store.values()) if (e.col === col && filters.every(f => test(e.data[f.f], f.op, f.v))) out.push(e);
  if (order) {
    const {f, desc} = order;
    out.sort((a, b) => {
      const x = a.data[f], y = b.data[f], mx = x === undefined, my = y === undefined;
      if (mx || my) return mx && my ? byId(a, b) : mx ? 1 : -1;   // alanı olmayan sona
      const c = cmp(x, y);
      return (desc ? -c : c) || byId(a, b);
    });
  } else out.sort(byId);
  if (lim) out = out.slice(0, lim);
  return out;
}

/* ---------- aboneler ---------- */
let dirtyCols = new Set(), notifyQueued = false;
function changed(col) {
  dirtyCols.add(col);
  if (!notifyQueued) { notifyQueued = true; queueMicrotask(deliverAll); }
}
function deliverAll() {
  notifyQueued = false;
  const cols = dirtyCols; dirtyCols = new Set();
  if (!ready) return;
  for (const l of [...listeners]) if (cols.has(l.col) && listeners.has(l)) deliver(l);
}
function deliver(l) {
  let snap;
  if (l.kind === 'd') {
    const e = store.get(l.key), s = e ? docSnap(e) : null;
    if (l.prev !== undefined && l.prev === s) return;
    l.prev = s; snap = s || missing(l.id);
  } else {
    const list = run(l.col, l.filters, l.order, l.lim).map(docSnap), prev = l.prev;
    if (prev && prev.length === list.length && prev.every((s, i) => s === list[i])) return;
    l.prev = list; snap = querySnap(list, prev);
  }
  try { l.next(snap); } catch (e) { later(() => { throw e; }); }
}
function listen(l) {
  if (typeof l.next !== 'function') throw new TypeError('onSnapshot bir fonksiyon bekler.');
  listeners.add(l);
  if (ready) queueMicrotask(() => { if (listeners.has(l)) deliver(l); });
  return () => { listeners.delete(l); };
}
function markReady() {
  if (ready) return;
  ready = true; readyResolve();
  for (const l of [...listeners]) if (listeners.has(l)) deliver(l);
}

/* ---------- referanslar ---------- */
function needUser() { if (!uid) throw dbErr('unavailable', 'Oturum açık değil.'); }
function docRef(col, id) {
  if (typeof col !== 'string' || !COL_RE.test(col) || typeof id !== 'string' || !ID_RE.test(id) || id === '.' || id === '..') {
    throw new TypeError(`Geçersiz belge yolu: ${col}/${id}`);
  }
  const key = col + '/' + id;
  return Object.freeze({
    id, path: key,
    async get() { await readyP; const e = store.get(key); return e ? docSnap(e) : missing(id); },
    async set(data) { needUser(); const d = clean(data); await loadedP; commit(col, id, d); },
    async update(patch) {
      needUser(); const p = clean(patch); await loadedP;
      const e = store.get(key);
      if (!e) throw dbErr('invalid_argument', `Belge yok: ${key}`);
      commit(col, id, merge(e.data, p));
    },
    async delete() { needUser(); await loadedP; commit(col, id, null); },
    onSnapshot(next, error) { return listen({kind: 'd', key, id, col, next, error, prev: undefined}); },
    collection() { throw new TypeError('Alt koleksiyonlar desteklenmiyor.'); },
  });
}
function makeQuery(col, filters, order, lim) {
  return {
    path: col,
    where(f, op, v) {
      if (!OPS.has(op)) throw new TypeError(`Geçersiz operatör: ${op}`);
      if (filters.length >= 10) throw new TypeError('En çok 10 filtre.');
      return makeQuery(col, [...filters, {f, op, v}], order, lim);
    },
    orderBy(f, dir) { return makeQuery(col, filters, {f, desc: dir === 'desc'}, lim); },
    limit(n) { return makeQuery(col, filters, order, Math.max(1, Math.min(1000, Math.floor(Number(n)) || 1))); },
    async get() { await readyP; return querySnap(run(col, filters, order, lim).map(docSnap), null); },
    onSnapshot(next, error) { return listen({kind: 'q', col, filters, order, lim, next, error, prev: null}); },
  };
}
function collection(path) {
  if (typeof path !== 'string' || !COL_RE.test(path)) throw new TypeError(`Geçersiz koleksiyon yolu: ${path}`);
  return Object.assign(makeQuery(path, [], null, 0), {
    doc: id => docRef(path, id === undefined ? newId() : id),
    async add(data) { const ref = docRef(path, newId()); await ref.set(data); return ref; },
  });
}
function doc(path) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  if (parts.length !== 2) throw new TypeError(`Belge yolu "kol/id" biçiminde olmalı: ${path}`);
  return docRef(parts[0], parts[1]);
}

/* ---------- yerel yazma ---------- */
function commit(col, id, data) {
  const key = col + '/' + id;
  if (data) { const prev = store.get(key); store.set(key, entry(col, id, deepFreeze(data), prev && prev.ts)); }
  else store.delete(key);
  touched.set(key, ++ctr);
  // Aynı belgenin henüz gönderilmemiş işlemi yenisiyle değişir: son durum taşındığı için sıra güvenli kalır.
  const i = outbox.findIndex(o => o.key === key && !inflight.has(o.seq));
  if (i >= 0) outbox.splice(i, 1);
  outbox.push({seq: ++seqN, key, col, id, op: data ? 'put' : 'del', data: data || null});
  dirtyDoc(key); dirtyOutbox(); changed(col); emitStatus();
  scheduleFlush(0);
}

/* ---------- kalıcılık ---------- */
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function idbOpen(name) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', {keyPath: 'k'});
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
async function openAdapter(userId) {
  try {
    if (!self.indexedDB) throw new Error('no idb');
    const d = await Promise.race([idbOpen('rota-' + userId), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    d.onversionchange = () => d.close();
    return {
      async load() {
        const t = d.transaction(['docs', 'kv']);
        const [docs, ob, mt] = await Promise.all([reqP(t.objectStore('docs').getAll()), reqP(t.objectStore('kv').get('outbox')), reqP(t.objectStore('kv').get('meta'))]);
        return {docs: docs || [], outbox: ob || [], meta: mt || {}};
      },
      save(puts, dels, ob, mt) {
        return new Promise(res => {
          let t;
          try { t = d.transaction(['docs', 'kv'], 'readwrite'); } catch (e) { res(false); return; }
          const ds = t.objectStore('docs'), kv = t.objectStore('kv');
          puts.forEach(r => ds.put(r)); dels.forEach(k => ds.delete(k));
          if (ob) kv.put(ob, 'outbox');
          if (mt) kv.put(mt, 'meta');
          t.oncomplete = () => res(true); t.onerror = t.onabort = () => res(false);
        });
      },
      close() { try { d.close(); } catch (e) { /* zaten kapalı */ } },
    };
  } catch (e) {
    return lsAdapter(userId);
  }
}
// IndexedDB yoksa yedek: tek anahtar altında JSON.
function lsAdapter(userId) {
  const K = 'rota-data-' + userId;
  let o = {docs: {}, outbox: [], meta: {}};
  try { const raw = localStorage.getItem(K); if (raw) o = Object.assign(o, JSON.parse(raw)); } catch (e) { /* boş başla */ }
  return {
    async load() { return {docs: Object.values(o.docs || {}), outbox: o.outbox || [], meta: o.meta || {}}; },
    async save(puts, dels, ob, mt) {
      puts.forEach(r => { o.docs[r.k] = r; }); dels.forEach(k => { delete o.docs[k]; });
      if (ob) o.outbox = ob; if (mt) o.meta = mt;
      try { localStorage.setItem(K, JSON.stringify(o)); return true; } catch (e) { return false; }
    },
    close() {},
  };
}
const dirty = new Set();
let dirtyOb = false, dirtyMeta = false, saveQueued = false;
function dirtyDoc(k) { dirty.add(k); queueSave(); }
function dirtyOutbox() { dirtyOb = true; queueSave(); }
function queueSave() { if (!saveQueued) { saveQueued = true; later(() => { saveNow(); }); } }
function saveNow(a = adapter) {
  saveQueued = false;
  if (!a || (!dirty.size && !dirtyOb && !dirtyMeta)) return Promise.resolve(true);
  const puts = [], dels = [];
  for (const k of dirty) { const e = store.get(k); if (e) puts.push({k, col: e.col, id: e.id, data: e.data, ts: e.ts}); else dels.push(k); }
  dirty.clear();
  const ob = dirtyOb ? outbox.map(o => ({seq: o.seq, key: o.key, col: o.col, id: o.id, op: o.op, data: o.data})) : null;
  const mt = dirtyMeta ? {...meta} : null;
  dirtyOb = dirtyMeta = false;
  return a.save(puts, dels, ob, mt).catch(() => false);
}

/* ---------- ağ ---------- */
function kindOf(error, status) {
  if (!error) return 'ok';
  if (!status) return 'net';
  if (status === 401 || /^PGRST30\d$/.test(String(error.code || ''))) return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'reject';
}
// Geçerli oturum yoksa (ya da başka kullanıcıya aitse) sunucuya hiç gidilmez: boş RLS cevabı yerel veriyi silemez.
async function haveSession() {
  if (!client) return false;
  try {
    const {data, error} = await client.auth.getSession();
    const s = data && data.session;
    if (s && s.user && s.user.id === uid) { if (lastError === 'auth') lastError = null; return true; }
    if (error && (error.name === 'AuthRetryableFetchError' || !error.status)) netDown = true;
    else lastError = 'auth';
  } catch (e) { netDown = true; }
  emitStatus();
  return false;
}
async function send(batch) {
  const puts = batch.filter(o => o.op === 'put'), dels = batch.filter(o => o.op === 'del');
  if (puts.length) {
    const r = await client.from('docs').upsert(puts.map(o => ({owner: uid, col: o.col, id: o.id, data: o.data})), {onConflict: 'owner,col,id'})
      .select('col,id,updated_at');
    const k = kindOf(r.error, r.status);
    if (k !== 'ok') return k;
    // Sunucu zamanını kaydet: kendi eski yazmamızın geç gelen yankısı yeni hali geri almasın.
    (r.data || []).forEach(row => {
      const key = row.col + '/' + row.id, t = tsMs(row.updated_at);
      if (t > (ackTs.get(key) || 0)) ackTs.set(key, t);
      tomb.delete(key);
      const e = store.get(key);
      if (e && tsMs(e.ts) < t) { e.ts = row.updated_at; dirtyDoc(key); }
    });
  }
  const byCol = new Map();
  dels.forEach(o => { if (!byCol.has(o.col)) byCol.set(o.col, []); byCol.get(o.col).push(o.id); });
  for (const [col, ids] of byCol) {
    const r = await client.from('docs').delete().eq('owner', uid).eq('col', col).in('id', ids);
    const k = kindOf(r.error, r.status);
    if (k !== 'ok') return k;
    ids.forEach(id => tomb.set(col + '/' + id, Date.now() + 15000));
  }
  return 'ok';
}
function scheduleFlush(ms) {
  if (!client) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = 0; flushOutbox(); }, ms);
}
function flushOutbox() {
  if (!client) return Promise.resolve();
  if (flushP) { flushAgain = true; return flushP; }
  flushP = (async () => {
    await loadedP;
    do {
      flushAgain = false;
      while (outbox.length && client) {
        if (!navigator.onLine) { netDown = true; return; }
        if (!(await haveSession())) return;
        const batch = [], keys = new Set();
        for (const o of outbox) { if (keys.has(o.key) || batch.length >= maxBatch) break; keys.add(o.key); batch.push(o); }
        batch.forEach(o => inflight.add(o.seq)); emitStatus();
        let k;
        try { k = await send(batch); } catch (e) { k = 'net'; } finally { batch.forEach(o => inflight.delete(o.seq)); }
        if (k === 'reject' && batch.length > 1) { maxBatch = 1; continue; }   // hatalı işlemi tek tek bul
        if (k === 'ok' || k === 'reject') {
          const sent = new Set(batch.map(o => o.seq));
          outbox = outbox.filter(o => !sent.has(o.seq));
          batch.forEach(o => touched.set(o.key, ++ctr));
          dirtyOutbox();
          if (k === 'ok') { netDown = false; backoff = 0; if (lastError === 'server' || lastError === 'rejected') lastError = null; }
          else { lastError = 'rejected'; console.warn('Rota: sunucu bir değişikliği reddetti; sunucudaki hali geri yüklenecek.', batch[0].key); later(() => pull(true)); }
          if (!outbox.length) maxBatch = BATCH;
          emitStatus();
          continue;
        }
        if (k === 'auth') { try { await client.auth.refreshSession(); } catch (e) { /* bir sonraki denemede */ } lastError = 'auth'; }
        else if (k === 'net') netDown = true;
        else lastError = 'server';
        backoff = Math.min(MAX_BACKOFF, backoff ? backoff * 2 : 1000);
        scheduleFlush(backoff + Math.random() * 500);
        return;
      }
    } while (flushAgain && outbox.length && client);
  })();
  const p = flushP;
  p.catch(() => {}).then(() => { if (flushP === p) flushP = null; emitStatus(); });
  return p.catch(() => {});
}

/* ---------- sunucudan çekme ---------- */
function applyServer(col, id, data, ts) {
  if (!isObj(data)) return;
  const key = col + '/' + id, e = store.get(key);
  if (e && deepEqual(e.data, data)) { if (e.ts !== ts) { e.ts = ts; dirtyDoc(key); } return; }
  store.set(key, entry(col, id, deepFreeze(data), ts));
  dirtyDoc(key); changed(col);
}
function removeLocal(key) {
  const e = store.get(key);
  if (!e) return;
  store.delete(key); dirtyDoc(key); changed(e.col);
}
function reconcile(rows, start) {
  const pend = new Set(outbox.map(o => o.key));
  const locked = k => pend.has(k) || (touched.get(k) || 0) > start;
  const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r.col !== 'string' || typeof r.id !== 'string') continue;
    const key = r.col + '/' + r.id;
    seen.add(key);
    if (!locked(key)) applyServer(r.col, r.id, r.data, r.updated_at);
  }
  for (const key of [...store.keys()]) if (!seen.has(key) && !locked(key)) removeLocal(key);
}
// again: çekme sürerken çağrılırsa bittiğinde bir kez daha çek (veri o arada değişmiş olabilir).
function pull(again = false) {
  if (!client) return Promise.resolve(false);
  if (pullP) { if (again) pullAgain = true; return pullP; }
  lastPullAt = Date.now();
  const p = pullP = (async () => {
    await loadedP;                                   // önbellek yüklenmeden sunucu verisiyle karşılaştırma yapılmaz
    if (!client) return false;
    if (!navigator.onLine) { netDown = true; return false; }
    if (!(await haveSession())) return false;
    const start = ctr, rows = [];
    for (let from = 0; ; from += PAGE) {
      const r = await client.from('docs').select('col,id,data,updated_at').order('col').order('id').range(from, from + PAGE - 1);
      const k = kindOf(r.error, r.status);
      if (k !== 'ok') {
        if (k === 'net') netDown = true; else lastError = k === 'auth' ? 'auth' : 'server';
        return false;
      }
      rows.push(...(r.data || []));
      if (!r.data || r.data.length < PAGE) break;
    }
    if (!client || p !== pullP) return false;
    reconcile(rows, start);
    meta = {...meta, lastSyncAt: Date.now()}; dirtyMeta = true; queueSave();
    netDown = false;
    if (lastError === 'server' || lastError === 'auth') lastError = null;
    return true;
  })().catch(() => { netDown = true; return false; });
  return p.then(ok => {
    if (pullP === p) pullP = null;
    if (client) markReady();
    // Ağ var görünüp çekme başarısızsa kendiliğinden yeniden dene (20 sn'den 2 dk'ya kadar).
    clearTimeout(pullRetryT);
    if (ok) pullBackoff = 0;
    else if (client && navigator.onLine) { pullBackoff = Math.min(120000, pullBackoff ? pullBackoff * 2 : 20000); pullRetryT = setTimeout(() => pull(), pullBackoff); }
    emitStatus();
    if (pullAgain && client) { pullAgain = false; pull(); }
    return ok;
  });
}

/* ---------- canlı değişiklikler ---------- */
function onChange(p) {
  const type = p.eventType, row = type === 'DELETE' ? p.old : p.new;
  if (!row || typeof row.col !== 'string' || typeof row.id !== 'string') return;
  if (row.owner && row.owner !== uid) return;
  const key = row.col + '/' + row.id;
  if (outbox.some(o => o.key === key)) return;   // yerel bekleyen yazma kazanır
  if (type === 'DELETE') { touched.set(key, ++ctr); removeLocal(key); return; }
  if ((tomb.get(key) || 0) > Date.now()) return;  // az önce sildiğimiz kaydın geç yankısı
  const e = store.get(key), a = tsMs(e && e.ts), b = tsMs(row.updated_at);
  if (a > b || b < (ackTs.get(key) || 0)) return;  // sıra dışı gelen eski olay
  touched.set(key, ++ctr);
  applyServer(row.col, row.id, row.data, row.updated_at);
}
// Çevrimdışıyken kanal kapatılır: tarayıcı boşuna WebSocket denemesin.
function dropChannel() {
  if (!channel || !client) return;
  const c = channel; channel = null; rtUp = false;
  Promise.resolve().then(() => client && client.removeChannel(c)).catch(() => {});
}
function subscribe() {
  if (channel || !client || !navigator.onLine) return;
  try {
    channel = client.channel('rota-docs-' + uid)
      .on('postgres_changes', {event: '*', schema: 'public', table: 'docs', filter: 'owner=eq.' + uid}, onChange)
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          const again = rtEver; rtEver = true; rtUp = true; emitStatus();
          if (again) pull(true);                     // yeniden bağlanınca kaçanları al
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { rtUp = false; emitStatus(); }
      });
  } catch (e) { channel = null; }
}

/* ---------- durum ---------- */
function status() {
  return {online: navigator.onLine && !netDown, pending: outbox.length, lastSyncAt: meta.lastSyncAt || null,
    error: lastError, realtime: rtUp, syncing: !!(flushP || pullP)};
}
let stQueued = false;
function emitStatus() {
  if (stQueued) return;
  stQueued = true;
  queueMicrotask(() => {
    stQueued = false;
    const s = status();
    statusCbs.forEach(cb => { try { cb(s); } catch (e) { console.warn(e); } });
  });
}

/* ---------- yaşam döngüsü ---------- */
async function start(opts) {
  const id = opts && opts.userId;
  if (!opts || !opts.client || !id) throw new TypeError('start({client, userId}) gerekli.');
  if (uid === id && client) return loadedP;
  if (uid) await stop();
  client = opts.client; uid = id;
  loadedP = (async () => {
    const a = await openAdapter(id);
    if (uid !== id) { a.close(); return; }
    adapter = a;
    let saved = {docs: [], outbox: [], meta: {}};
    try { saved = await a.load(); } catch (e) { console.warn('Rota: yerel kayıt okunamadı.', e); }
    if (uid !== id) return;
    for (const r of saved.docs) if (r && typeof r.col === 'string' && typeof r.id === 'string' && isObj(r.data)) store.set(r.col + '/' + r.id, entry(r.col, r.id, deepFreeze(r.data), r.ts));
    outbox = Array.isArray(saved.outbox) ? saved.outbox.filter(o => o && o.key && (o.op === 'put' || o.op === 'del')) : [];
    seqN = outbox.reduce((m, o) => Math.max(m, o.seq || 0), 0);
    meta = isObj(saved.meta) ? saved.meta : {};
    new Set([...store.values()].map(e => e.col)).forEach(changed);
    if (meta.lastSyncAt) markReady();               // önbellek var: hemen çiz
    emitStatus();
  })();
  await loadedP;
  if (uid !== id) return;
  subscribe();
  (async () => { await flushOutbox(); await pull(); })();
}
async function stop() {
  // Kanal kapanışı yanıt beklemeye takılmasın (oturum kapanınca onay gelmeyebilir).
  if (channel && client) { try { await Promise.race([client.removeChannel(channel), new Promise(r => setTimeout(r, 600))]); } catch (e) { /* önemsiz */ } }
  channel = null; rtUp = false; rtEver = false;
  clearTimeout(flushTimer); flushTimer = 0; clearTimeout(pullRetryT); pullBackoff = 0;
  const a = adapter; adapter = null;
  if (a) { await saveNow(a); a.close(); }
  client = null; uid = null; store = new Map(); outbox = []; touched.clear(); ackTs.clear(); tomb.clear(); inflight.clear();
  meta = {}; lastError = null; netDown = false; backoff = 0; flushP = null; pullP = null;
  listeners.clear(); resetReady();
  emitStatus();
}
async function clear(userId) {
  const id = userId || uid;
  if (!id) return;
  if (id === uid) await stop();
  try { localStorage.removeItem('rota-data-' + id); } catch (e) { /* yok */ }
  if (!self.indexedDB) return;
  await new Promise(res => {
    try { const r = indexedDB.deleteDatabase('rota-' + id); r.onsuccess = r.onerror = r.onblocked = () => res(); }
    catch (e) { res(); }
    setTimeout(res, 3000);
  });
}
async function syncNow() {
  if (!client) return status();
  backoff = 0;
  await flushOutbox();
  await pull();
  if (outbox.length) await flushOutbox();
  return status();
}

addEventListener('online', () => { netDown = false; emitStatus(); if (client) { backoff = 0; subscribe(); flushOutbox(); pull(); } });
addEventListener('offline', () => { dropChannel(); emitStatus(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveNow(); return; }
  if (!client) return;
  if (Date.now() - lastPullAt > PULL_GAP) pull();
  if (outbox.length) flushOutbox();
});
addEventListener('pagehide', () => { saveNow(); });

window.RotaDB = Object.freeze({collection, doc});
window.RotaSync = Object.freeze({
  start, stop, clear, status,
  flush: syncNow,
  // Oturum yenilenince ya da ağ dönünce çağrılır.
  kick() { if (!client) return; backoff = 0; flushOutbox(); if (lastError === 'auth' || !meta.lastSyncAt || !ready) pull(); },
  onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
});
})();
