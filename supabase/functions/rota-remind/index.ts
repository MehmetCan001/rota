/* Rota hatırlatmaları. pg_cron her dakika çağırır (POST, gövde boş).
   - Saati gelen program blokları ve saatli işler için kullanıcının telefonuna Web Push gönderir.
   - Aynı hatırlatma iki kez gitmez: her gönderim docs tablosuna sistem sahibiyle bir "pushlog" satırı olarak
     önce talep edilir (birincil anahtar çakışırsa atlanır). Bu yüzden fazladan çağrı zararsızdır.
   - VAPID anahtarları ilk çağrıda üretilip yine sistem sahibiyle saklanır; RLS kullanıcıların bunları görmesini engeller.
   GET ?vapid=1 herkese açık anahtarı döner. POST {test: true} + kullanıcı oturumu: o kullanıcıya deneme bildirimi. */

/* ---------- Web Push: VAPID (RFC 8292) + aes128gcm (RFC 8188/8291), yalnız WebCrypto ---------- */
const te = new TextEncoder();

function b64u(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function ub64(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function cat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// Yeni VAPID anahtar çifti: herkese açık anahtar (ham, 65 bayt) ve özel anahtar (JWK).
async function generateVapid() {
  const kp = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return {publicKey: b64u(pub), privateJwk: {kty: j.kty, crv: j.crv, x: j.x, y: j.y, d: j.d}};
}

// RFC 8291: tarayıcının anahtarıyla tek kayıtlık aes128gcm gövdesi.
async function encrypt(sub, payload) {
  const ua = ub64(sub.keys.p256dh), auth = ub64(sub.keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', ua, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const as = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaKey}, as.privateKey, 256));
  const prkKey = await hmac(auth, secret);
  const ikm = await hmac(prkKey, cat(te.encode('WebPush: info\0'), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, {name: 'AES-GCM'}, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce}, key, cat(te.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21 + asPub.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  head.set(asPub, 21);
  return cat(head, ct);
}

async function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin, exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const h = b64u(te.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const c = b64u(te.encode(JSON.stringify({aud, exp, sub: subject})));
  const key = await crypto.subtle.importKey('jwk', {...vapid.privateJwk, ext: true}, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, te.encode(h + '.' + c));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// gone: abonelik artık geçersiz (404/410), kaydı silinmeli.
async function sendPush(sub, payload, vapid, subject, opts = {}) {
  const body = await encrypt(sub, payload);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl ?? 900),
      Urgency: opts.urgency || 'high',
    },
    body,
  });
  const text = res.ok ? '' : await res.text().catch(() => '');
  return {status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, text: text.slice(0, 200)};
}

/* ---------- hatırlatmalar ---------- */
const SB = Deno.env.get('SUPABASE_URL') || '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SYS = '00000000-0000-0000-0000-000000000000';
const SUBJECT = 'https://mehmetcan001.github.io/rota/';
const TZ = 'Europe/Istanbul';
const WINDOW = 3;   // dk: gecikmiş ya da kaçmış bir cron turunu telafi eder
const ORIGINS = ['https://mehmetcan001.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];

const cors = req => {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
};
const json = (req, body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors(req), 'Content-Type': 'application/json'}});

/* ---------- veritabanı (PostgREST, servis anahtarı) ---------- */
const H = extra => ({apikey: KEY, ...(KEY.startsWith('eyJ') ? {Authorization: `Bearer ${KEY}`} : {}), 'Content-Type': 'application/json', ...extra});
async function rest(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {...init, headers: H(init.headers || {})});
  if (!r.ok && r.status !== 409) throw new Error(`rest ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}
const get = async path => (await rest(path)).json();
const inList = a => `in.(${a.map(x => `"${String(x).replace(/["\\,()]/g, '')}"`).join(',')})`;

async function vapidKeys() {
  const rows = await get(`docs?owner=eq.${SYS}&col=eq.sys&id=eq.vapid&select=data`);
  if (rows[0]) return rows[0].data;
  const v = await generateVapid();
  await rest('docs', {method: 'POST', headers: {Prefer: 'return=minimal'}, body: JSON.stringify({owner: SYS, col: 'sys', id: 'vapid', data: v})});
  return (await get(`docs?owner=eq.${SYS}&col=eq.sys&id=eq.vapid&select=data`))[0].data;   // yarışta kazananın anahtarı
}
// true: bu hatırlatmayı bu çağrı gönderir. false: daha önce gönderilmiş.
async function claim(id) {
  const r = await rest('docs', {method: 'POST', headers: {Prefer: 'return=minimal'},
    body: JSON.stringify({owner: SYS, col: 'pushlog', id, data: {at: new Date().toISOString()}})});
  return r.status !== 409;
}

/* ---------- zaman ---------- */
function ist(ms) {
  const f = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'});
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const dow = {Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7}[p.weekday] || 1;
  return {date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), dow};
}
const toMin = s => { const [h, m] = String(s || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const fmtDur = m => { const h = Math.floor(m / 60), r = m % 60; return h ? `${h} sa${r ? ` ${r} dk` : ''}` : `${r} dk`; };
const firstLine = s => String(s || '').split('\n').map(x => x.trim()).find(Boolean) || '';
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/* ---------- kullanıcıların o günkü maddeleri ---------- */
async function loadCtx(uids, date) {
  const personal = await get(`docs?owner=${inList(uids)}&col=in.(prefs,routine,mytasks)&select=owner,col,id,data`);
  const days = await get(`docs?owner=${inList(uids)}&col=eq.days&id=eq.${date}&select=owner,data`);
  const mem = await get(`space_members?user_id=${inList(uids)}&select=user_id,slug,space`);
  const spaces = [...new Set(mem.map(m => m.space))];
  const shared = spaces.length ? await get(`docs?owner=${inList(spaces)}&col=eq.tasks&select=owner,id,data&data->>due=eq.${date}`) : [];
  return {personal, days, mem, shared};
}
function itemsFor(ctx, uid, date, dow) {
  const mine = ctx.personal.filter(r => r.owner === uid);
  const prefs = (mine.find(r => r.col === 'prefs' && r.id === 'app') || {}).data || {};
  const day = (ctx.days.find(r => r.owner === uid) || {}).data || {};
  const m = ctx.mem.find(x => x.user_id === uid);
  const done = day.done || {};
  const out = [];
  if (day.joker) return {prefs, items: out};
  for (const r of mine) {
    const b = r.data;
    if (r.col !== 'routine' || !b.start || done[r.id] || (day.bad && !b.core)) continue;
    if (!(b.dow === 0 || b.dow === dow)) continue;
    const mins = b.end ? Math.max(0, toMin(b.end) - toMin(b.start)) : Number(b.min) || 0;
    out.push({kind: 'b', id: r.id, title: b.title, start: b.start, end: b.end || '', mins, note: b.note || ''});
  }
  const task = (r, t) => out.push({kind: 't', id: r.id, title: t.title, start: t.time, end: '', mins: Number(t.min) || 0, note: t.note || ''});
  for (const r of mine) if (r.col === 'mytasks' && r.data.due === date && r.data.time && !r.data.done) task(r, r.data);
  if (m) for (const r of ctx.shared) {
    const t = r.data;
    if (r.owner !== m.space || t.due !== date || !t.time || t.done) continue;
    const w = t.who || 'ben';
    if (w === m.slug || w === 'ikimiz' || w === 'ben') task(r, t);
  }
  return {prefs, items: out};
}
// Aynı dakikadaki maddeler tek bildirimde: önce iş (daha somut), sonra blok.
function message(group, lead) {
  const g = [...group].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 't' ? -1 : 1));
  const p = g[0], end = p.end || (p.mins ? hm(toMin(p.start) + p.mins) : '');
  const when = `${p.start}${end ? `–${end}` : ''}${p.mins ? ` · ${fmtDur(p.mins)}` : ''}${lead ? ` · ${lead} dk sonra` : ''}`;
  const lines = [when, clip(firstLine(p.note), 140)].filter(Boolean);
  if (g.length > 1) lines.push(`Ayrıca: ${g.slice(1).map(x => x.title).join(', ')}`);
  return {title: p.title, body: lines.join('\n'), tag: `rota-${p.start}`, url: './?tab=bugun'};
}

async function subsOf(uids) {
  const q = uids ? `&owner=${inList(uids)}` : '';
  return get(`docs?col=eq.push${q}&select=owner,id,data`);
}
async function deliver(vapid, subs, msg) {
  let sent = 0;
  for (const s of subs) {
    if (!s.data || !s.data.endpoint || !s.data.keys) continue;
    try {
      const r = await sendPush(s.data, JSON.stringify({...msg, ts: Date.now()}), vapid, SUBJECT);
      if (r.ok) sent++;
      else if (r.gone) await rest(`docs?owner=eq.${s.owner}&col=eq.push&id=eq.${encodeURIComponent(s.id)}`, {method: 'DELETE'});
      else console.warn('push', r.status, r.text);
    } catch (e) { console.warn('push hata', String(e)); }
  }
  return sent;
}

async function runCron() {
  const subs = await subsOf(null);
  if (!subs.length) return {users: 0, sent: 0};
  const now = ist(Date.now()), uids = [...new Set(subs.map(s => s.owner))];
  const ctx = await loadCtx(uids, now.date), vapid = await vapidKeys();
  let sent = 0;
  for (const uid of uids) {
    const {prefs, items} = itemsFor(ctx, uid, now.date, now.dow);
    const n = prefs.notify || {};
    if (n.on === false) continue;
    const lead = [0, 5, 10, 15].includes(Number(n.lead)) ? Number(n.lead) : 0;
    const groups = new Map();
    for (const it of items) {
      const fire = toMin(it.start) - lead;
      if (fire < 0 || fire > now.min || fire <= now.min - WINDOW) continue;
      if (!groups.has(it.start)) groups.set(it.start, []);
      groups.get(it.start).push(it);
    }
    for (const [start, group] of groups) {
      if (!(await claim(`${now.date}_${start}_${uid}`))) continue;
      sent += await deliver(vapid, subs.filter(s => s.owner === uid), message(group, lead));
    }
  }
  // Eski kayıtlar: saatte bir, iki günden eski pushlog satırları silinir.
  if (now.min % 60 === 0) {
    const old = ist(Date.now() - 2 * 864e5).date;
    await rest(`docs?owner=eq.${SYS}&col=eq.pushlog&id=lt.${old}`, {method: 'DELETE'}).catch(() => {});
  }
  return {users: uids.length, sent, at: `${now.date} ${hm(now.min)}`};
}

async function runTest(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return json(req, {error: 'oturum yok'}, 401);
  const u = await fetch(`${SB}/auth/v1/user`, {headers: {apikey: KEY, Authorization: auth}});
  if (!u.ok) return json(req, {error: 'oturum geçersiz'}, 401);
  const uid = (await u.json()).id;
  const subs = await subsOf([uid]);
  if (!subs.length) return json(req, {error: 'abonelik yok', sent: 0}, 404);
  const now = ist(Date.now()), ctx = await loadCtx([uid], now.date);
  const next = itemsFor(ctx, uid, now.date, now.dow).items.filter(i => toMin(i.start) > now.min).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  const msg = {title: 'Hatırlatmalar açık', body: next ? `Sıradaki: ${next.start} ${next.title}` : 'Bugün için saati gelecek madde kalmadı.', tag: 'rota-test', url: './?tab=bugun'};
  const sent = await deliver(await vapidKeys(), subs, msg);
  return json(req, {sent});
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: cors(req)});
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.has('vapid')) return json(req, {publicKey: (await vapidKeys()).publicKey});
    if (req.method !== 'POST') return json(req, {error: 'yöntem'}, 405);
    const body = await req.json().catch(() => ({}));
    if (body && body.test) return await runTest(req);
    return json(req, await runCron());
  } catch (e) {
    console.error('rota-remind', String(e));
    return json(req, {error: 'iç hata'}, 500);
  }
});
