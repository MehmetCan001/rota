/* Rota arayüzü: Bugün, Hafta, Plan, Liste. Görünümler RotaDB anlık görüntülerinden çizilir;
   her yazma yerelde hemen uygulanır, eşitleme arka planda RotaSync ile yürür. */
(() => {
'use strict';
const DOW_L = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DOW_S = ['', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MON_L = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MON_S = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const TABS = ['bugun', 'hafta', 'plan', 'liste'];
const DEF_WHO = {ben: 'Ben', ortak: 'Ortak', ikimiz: 'İkimiz'};
const DEF_START = '2026-11-01', DEF_MONTHS = 24;
const VERSION = String(self.APP_VERSION || '');
const nf = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 0});
const nf1 = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1});
const SVG = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHEV = SVG('<path d="m6 9 6 6 6-6"/>');
const CHEV_R = SVG('<path d="m9 6 6 6-6 6"/>');
const X_ICON = SVG('<path d="M6 6l12 12M18 6 6 18"/>');
const EYE = SVG('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', 1.8);
const EYE_OFF = SVG('<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.9M6.3 7.3C3.9 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 1.8);

const S = {tasks: [], routine: [], phases: [], ideas: [], days: {}, weeks: {}, metrics: null, settings: null, got: {},
  tab: 'bugun', weekOff: 0, selDay: null, tplEdit: false, open: {}, preset: {}, lastKey: '', pop: null, enter: false,
  toastFn: null, user: null, running: false, sync: null, action: null, sheet: '', akeys: null};
try { const t = localStorage.getItem('rota-tab'); if (TABS.includes(t)) S.tab = t; } catch (e) { /* depolama kapalı */ }
let db = null;

/* ---------- tarih ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dow = d => ((d.getDay() + 6) % 7) + 1;
const monday = d => addDays(d, 1 - dow(d));
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayKey = () => iso(today());
const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const shortDate = key => { const d = parse(key); return `${d.getDate()} ${MON_S[d.getMonth()] || ''} ${DOW_S[dow(d)] || ''}`; };
// Türkçe bulunma eki: 2026’da, 2027’de, 22:30’da, 23:00’te
const LOC1 = ['', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'], LOC10 = ['', 'da', 'de', 'da', 'ta', 'de', 'ta', 'te', 'de', 'da'];
const locSuf = n => { n = Math.abs(Math.round(n)); return n % 10 ? LOC1[n % 10] : n % 100 ? LOC10[Math.floor(n / 10) % 10] : 'de'; };
const atTime = t => { const [h, m] = String(t).split(':').map(Number); return `${t}’${locSuf(m || h || 0)}`; };
function dueLabel(key) {
  const diff = Math.round((parse(key) - today()) / 864e5);
  if (diff === 0) return ['Bugün', ''];
  if (diff === 1) return ['Yarın', ''];
  if (diff < 0) return [`${-diff} gün gecikti`, 'late'];
  return [shortDate(key), ''];
}
function greeting() { const h = new Date().getHours(); return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : h < 23 ? 'İyi akşamlar' : 'İyi geceler'; }

/* ---------- ayarlar (settings/app belgesi) ---------- */
const cfg = () => S.settings || {};
function planStart() { const s = cfg().planStart; return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? parse(s) : parse(DEF_START); }
const planMonths = () => { const n = Math.round(Number(cfg().planMonths)); return n >= 1 && n <= 120 ? n : DEF_MONTHS; };
const planMonth = d => { const p = planStart(); return (d.getFullYear() - p.getFullYear()) * 12 + d.getMonth() - p.getMonth() + 1; };
function monthLine(d) {
  const m = planMonth(d), n = planMonths();
  if (m < 1) return `Plan ${Math.max(1, Math.round((planStart() - d) / 864e5))} gün sonra başlıyor`;
  if (m > n) return 'Plan süresi doldu';
  return `Ay ${m} / ${n}`;
}
const cap = s => s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1) : '';
function areaKeys() {
  if (S.akeys) return S.akeys;
  const c = cfg(), labels = c.areas && typeof c.areas === 'object' ? c.areas : {};
  const keys = Array.isArray(c.areaOrder) ? c.areaOrder.filter(k => typeof k === 'string' && k) : [];
  Object.keys(labels).forEach(k => { if (!keys.includes(k)) keys.push(k); });
  if (!keys.length) [...S.routine, ...S.tasks].forEach(x => { if (typeof x.area === 'string' && x.area && !keys.includes(x.area)) keys.push(x.area); });
  return (S.akeys = keys);
}
function areaLabel(k) {
  if (!k) return '';
  const a = cfg().areas;
  return (a && typeof a[k] === 'string' && a[k]) || cap(String(k));
}
const areaIdx = k => { const i = areaKeys().indexOf(k); return i < 0 ? 7 : (i % 7) + 1; };
const focusArea = () => { const f = cfg().focusArea; return typeof f === 'string' && f ? f : areaKeys()[0] || ''; };
const defaultArea = () => focusArea() || areaKeys()[0] || '';
const incLabel = () => focusArea() ? `${areaLabel(focusArea())} net geliri` : 'Net gelir';
const whoMap = () => { const w = cfg().who; return {ben: (w && w.ben) || DEF_WHO.ben, ortak: (w && w.ortak) || DEF_WHO.ortak, ikimiz: (w && w.ikimiz) || DEF_WHO.ikimiz}; };
const whoLabel = k => whoMap()[k] || String(k);

/* ---------- yardımcılar ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const byOrder = (a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
const fmtDur = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} sa${r ? ` ${r} dk` : ''}` : `${r} dk`; };
function blockMin(b) { return b.start && b.end ? Math.max(0, toMin(b.end) - toMin(b.start)) : Number(b.min) || 0; }
const sortKey = b => b.start || (b.dow === 0 ? '00:00' : '23:59');
const sortBlocks = list => list.sort((a, b) => String(sortKey(a)).localeCompare(String(sortKey(b))) || byOrder(a, b));
const blocksFor = d => { const w = dow(d); return sortBlocks(S.routine.filter(b => b.dow === 0 || b.dow === w)); };
const coreBlock = () => sortBlocks(S.routine.filter(b => b.core && b.dow === 0))[0] || sortBlocks(S.routine.filter(b => b.core))[0] || null;
const dayDoc = key => S.days[key] || {};
const isDone = (key, id) => !!((dayDoc(key).done || {})[id]);
function dayCount(key, d) {
  const bad = dayDoc(key).bad, bl = blocksFor(d).filter(b => !bad || b.core);
  return {total: bl.length, done: bl.filter(b => isDone(key, b.id)).length};
}
const phases = () => [...S.phases].sort(byOrder);
const tasksOf = pid => S.tasks.filter(t => t.phase === pid).sort(byOrder);
function phaseDone(p) {
  const ts = tasksOf(p.id), gates = ts.filter(t => t.kind === 'gate'), set = gates.length ? gates : ts;
  return set.length > 0 && set.every(t => t.done);
}
const focusPhase = () => phases().find(p => !phaseDone(p)) || phases().slice(-1)[0];
function weekEnergy(mon) {
  const vals = [];
  for (let i = 0; i < 7; i++) { const e = Number(dayDoc(iso(addDays(mon, i))).energy); if (e) vals.push(e); }
  return vals.length ? {avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length} : null;
}
function energyRule() {
  const m = monday(today()), w1 = weekEnergy(addDays(m, -7)), w2 = weekEnergy(addDays(m, -14));
  return !!(w1 && w2 && w1.n >= 2 && w2.n >= 2 && w1.avg <= 2 && w2.avg <= 2);
}
const dot = a => `<i class="dot d-${areaIdx(a)}"></i>`;
const ring = (done, total) => {
  const p = total ? Math.round(done / total * 100) : 0;
  return `<div class="ring" role="img" aria-label="Bugün ${done} / ${total} tamam"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.5"/>
    <circle class="fg" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="${p} 100"/></svg><div><b>${done}/${total}</b><small>TAMAM</small></div></div>`;
};

/* ---------- eşitleme durumu ---------- */
function syncState(st) {
  if (!st) return 'wait';
  if (!st.online) return 'off';
  if (st.error === 'auth' || st.error === 'server' || st.error === 'rejected') return 'err';
  if (st.pending || !st.lastSyncAt) return 'wait';
  return 'ok';
}
function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return shortDate(iso(new Date(ms)));
}
function syncText(st) {
  const s = syncState(st), n = (st && st.pending) || 0;
  if (s === 'off') return ['Çevrimdışı · değişiklikler cihazda', n ? `${n} değişiklik bağlantı gelince gönderilecek.` : 'Bağlantı gelince kendiliğinden eşitlenir.'];
  if (s === 'err') return [n ? `${n} değişiklik bekliyor` : 'Eşitleme sorunu',
    st.error === 'auth' ? 'Oturum yenilenemedi. Sürerse çıkış yapıp yeniden gir.' : st.error === 'rejected' ? 'Bir değişiklik sunucuda kaydedilemedi.' : 'Sunucuya ulaşılamadı. Kendiliğinden yeniden denenecek.'];
  if (s === 'wait') return n ? [`${n} değişiklik bekliyor`, 'Buluta gönderiliyor.'] : ['Eşitleniyor', 'Veriler buluttan alınıyor.'];
  return [`Eşitlendi · ${ago(st.lastSyncAt)}`, st.realtime ? 'Diğer cihazlardaki değişiklikler anında gelir.' : 'Veriler bu cihazda ve bulutta.'];
}
const initial = () => { const e = (S.user && S.user.email) || ''; return e ? e.charAt(0).toLocaleUpperCase('tr-TR') : 'R'; };
const meBtn = () => `<button class="me-btn" type="button" data-act="settings" aria-label="${esc('Hesap ve ayarlar · ' + syncText(S.sync)[0])}"><span aria-hidden="true">${esc(initial())}</span><i class="sync-dot s-${syncState(S.sync)}" aria-hidden="true"></i></button>`;
const top = eb => `<div class="topline"><p class="eyebrow">${eb}</p>${meBtn()}</div>`;
function syncUI() {
  const s = syncState(S.sync), [l1, l2] = syncText(S.sync);
  document.querySelectorAll('.me-btn .sync-dot').forEach(d => { d.className = 'sync-dot s-' + s; });
  document.querySelectorAll('.me-btn').forEach(b => b.setAttribute('aria-label', 'Hesap ve ayarlar · ' + l1));
  if (S.sheet === 'settings') {
    const dEl = $('#setDot'), a = $('#setLine'), b = $('#setSub'), btn = $('#syncBtn');
    if (dEl) dEl.className = 'sync-dot s-' + s;
    if (a) a.textContent = l1;
    if (b) b.textContent = l2;
    if (btn) btn.classList.toggle('busy', !!(S.sync && S.sync.syncing));
  }
}

/* ---------- satırlar ---------- */
function taskRow(t, o = {}) {
  const [dl, cls] = t.due ? dueLabel(t.due) : ['', ''];
  const meta = [`${dot(t.area)}${esc(t.area ? areaLabel(t.area) : 'Kişisel')}`];
  if (dl && !t.done) meta.push(`<span class="${cls}">${esc(dl)}</span>`);
  if (t.who && t.who !== 'ben') meta.push(`<span class="who">${esc(whoLabel(t.who))}</span>`);
  return `<div class="row${t.done ? ' is-done' : ''}${t.kind === 'gate' ? ' is-gate' : ''}">
    <button class="chk${S.pop === t.id ? ' pop' : ''}" type="button" data-act="toggleTask" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${esc(t.title)}"></button>
    <button class="row-main" type="button" data-act="editTask" data-id="${esc(t.id)}"><span class="row-title">${esc(t.title)}</span>
      <span class="row-meta">${meta.join('<span class="sep">·</span>')}</span>${o.note && t.note && !t.done ? `<span class="row-note">${esc(t.note)}</span>` : ''}</button>
    ${o.pull ? `<button class="mini" type="button" data-act="pullToday" data-id="${esc(t.id)}">Bugüne al</button>` : ''}
  </div>`;
}
function blockRow(b, key, bad, locked) {
  const done = isDone(key, b.id), dim = bad && !b.core, mm = blockMin(b);
  const time = b.start ? `<span class="tl-time">${esc(b.start)}${b.end ? `<small>${esc(b.end)}</small>` : ''}</span>` : '<span class="tl-time any">GÜN İÇİ</span>';
  const meta = `<span class="row-meta">${dot(b.area)}${esc(areaLabel(b.area))}${mm ? `<span class="sep">·</span>${fmtDur(mm)}` : ''}${b.core ? '<span class="sep">·</span>her koşulda' : ''}</span>`;
  const body = b.review
    ? `<button class="tl-body" type="button" data-act="review" data-week="${iso(monday(parse(key)))}"><span class="row-title">${esc(b.title)}</span>${meta}<span class="row-link">Değerlendirmeyi yaz</span></button>`
    : `<div class="tl-body"><span class="row-title">${esc(b.title)}</span>${meta}</div>`;
  return `<div class="tl-row${done ? ' is-done' : ''}${dim ? ' is-dim' : ''}">${time}
    <button class="chk round${S.pop === key + ':' + b.id ? ' pop' : ''}" type="button" data-act="toggleBlock" data-id="${esc(b.id)}" data-date="${key}" aria-pressed="${done}" aria-label="${esc(b.title)}"${locked || dim ? ' disabled' : ''}></button>${body}</div>`;
}
const stamp = (ok, big) => `<span class="stamp${ok ? ' ok' : ''}${big ? ' big' : ''}" role="img" aria-label="${ok ? 'Kapı geçildi' : 'Kapı bekliyor'}">${ok ? 'GEÇTİ' : 'KAPI'}</span>`;

/* ---------- Şimdi kartı ---------- */
function nowCard(d, key, bl, dd) {
  const w = dow(d), mins = nowMin(), active = bl.filter(b => !dd.bad || b.core), timed = active.filter(b => b.start);
  const onlyDaily = bl.every(b => b.dow === 0);
  const close = bl.filter(b => b.dow === 0 && b.start && !b.end).map(b => b.start).sort().pop();
  const btn = b => `<button class="now-btn" type="button" data-act="toggleBlock" data-id="${esc(b.id)}" data-date="${key}">Bitti</button>`;
  const card = (eb, title, meta, b, pct) => `<section class="now" aria-label="Şimdi"><div class="now-top"><p class="now-eb">${esc(eb)}</p>${b ? btn(b) : ''}</div>
    <h2 class="now-title">${esc(title)}</h2>${meta ? `<p class="now-meta">${esc(meta)}</p>` : ''}${pct != null ? `<div class="now-bar"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>` : ''}</section>`;
  const cur = timed.find(b => b.end && toMin(b.start) <= mins && mins < toMin(b.end) && !isDone(key, b.id));
  if (cur) { const s = toMin(cur.start), e = toMin(cur.end); return card('Şu an', cur.title, `${cur.start}–${cur.end} · ${fmtDur(e - mins)} kaldı`, cur, (mins - s) / (e - s) * 100); }
  const core = active.find(b => b.core && !isDone(key, b.id));
  if (onlyDaily || dd.bad) {
    const why = dd.bad ? 'Kötü gün. Telafi yok.' : `${DOW_L[w]} akşamı boş.`;
    return core ? card('Günün tek şartı', core.title, why, core) : card('Bugün', 'Günün şartı tamam.', `${why}${close ? ` ${atTime(close)} kapat.` : ''}`, null);
  }
  const next = timed.filter(b => toMin(b.start) > mins && !isDone(key, b.id)).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  if (next) return card(`Sıradaki · ${fmtDur(toMin(next.start) - mins)} sonra`, next.title, next.end ? `${next.start}–${next.end} · ${fmtDur(blockMin(next))}` : next.start, next);
  const left = active.filter(b => !isDone(key, b.id));
  if (left.length) return card(`Kalan · ${left.length} blok`, left[0].title, 'Saati geçti. Yaptıysan işaretle.', left[0]);
  return card('Bugün', 'Program tamam.', `${close ? `${atTime(close)} kapat. ` : ''}Yarın devam.`, null);
}

/* ---------- görünümler ---------- */
function viewToday() {
  const d = today(), key = iso(d), w = dow(d), dd = dayDoc(key), fp = focusPhase(), bl = blocksFor(d), c = dayCount(key, d);
  const core = coreBlock(), coreT = core ? core.title : '';
  const tot = bl.filter(b => !dd.bad || b.core).reduce((s, b) => s + blockMin(b), 0);
  let h = `<header class="head">${top(greeting())}<div class="hero with-ring"><div><h1>${DOW_L[w]}</h1><p class="sub">${d.getDate()} ${MON_L[d.getMonth()]} · ${monthLine(d)}</p></div>${ring(c.done, c.total)}</div></header>`;
  h += nowCard(d, key, bl, dd);
  if (energyRule()) h += `<div class="banner"><strong>Enerji kuralı</strong>Enerji iki haftadır 2/5 ya da altında. Bu hafta ara ver, plan bir hafta kayar.</div>`;

  h += `<section class="card"><div class="card-head"><h2>Program</h2><span class="count">${tot ? fmtDur(tot) : ''}</span></div>
    ${bl.length ? `<div class="tl">${bl.map(b => blockRow(b, key, dd.bad, false)).join('')}</div>` : '<p class="empty">Bugün için şablonda blok yok.</p>'}</section>`;

  const only = coreT ? esc(coreT) : 'her koşulda yapılan bloklar';
  const lit = n => dd.energy && n <= dd.energy && n !== dd.energy ? ' lit' : '';
  h += `<section class="card"><div class="card-head"><h2>Günün durumu</h2></div>
    <div class="segc" role="group" aria-label="Gün türü"><button type="button" data-act="setBad" data-v="0" data-date="${key}" aria-pressed="${!dd.bad}">Normal gün</button>
      <button type="button" class="bad" data-act="setBad" data-v="1" data-date="${key}" aria-pressed="${!!dd.bad}">Kötü gün</button></div>
    <p class="hint">${dd.bad ? `Sadece ${only} sayılır. Telafi yok.` : `Zor bir günse kötü günü seç: sadece ${only} sayılır.`}</p>
    <div class="energy"><div class="energy-l"><b>Enerji</b><small>1 düşük, 5 yüksek</small></div>
      ${[1, 2, 3, 4, 5].map(n => `<button class="en${lit(n)}" type="button" data-act="energy" data-date="${key}" data-n="${n}" aria-pressed="${dd.energy === n}" aria-label="Enerji ${n}">${n}</button>`).join('')}</div>
  </section>`;

  const tk = S.tasks.filter(t => (!t.done && t.due && t.due <= key) || (t.done && t.doneAt === key && t.due))
    .sort((a, b) => (a.done - b.done) || String(a.due || '').localeCompare(String(b.due || '')) || byOrder(a, b));
  h += `<section class="card"><div class="card-head"><h2>Bugünün işleri</h2><span class="count">${tk.filter(t => t.done).length}/${tk.length}</span></div>
    ${tk.length ? tk.map(t => taskRow(t)).join('') : '<p class="empty">Bugüne iş atanmadı. Aşağıdan birini bugüne al ya da + ile ekle.</p>'}</section>`;
  if (fp) {
    const next = tasksOf(fp.id).filter(t => !t.done && !t.due && t.kind !== 'gate').slice(0, 4);
    h += `<section class="card"><div class="card-head"><h2>Sıradaki</h2><span class="count">${esc(fp.no)} · ${esc(fp.title)}</span></div>
      ${next.length ? next.map(t => taskRow(t, {pull: true})).join('') : '<p class="empty">Bu aşamada tarihsiz açık iş kalmadı.</p>'}</section>`;
  }
  return h;
}

function viewWeek() {
  if (S.tplEdit) return viewTemplate();
  const mon = addDays(monday(today()), S.weekOff * 7), sun = addDays(mon, 6), tkey = todayKey(), monKey = iso(mon);
  const keys = Array.from({length: 7}, (_, i) => iso(addDays(mon, i)));
  const sel = S.selDay && keys.includes(S.selDay) ? S.selDay : keys.includes(tkey) ? tkey : keys[0];
  const fa = focusArea(), core = coreBlock();
  let faPlan = 0, faDone = 0, coreDays = 0, coreTotal = 0;
  keys.forEach(k => {
    const bl = blocksFor(parse(k));
    bl.forEach(b => { if (fa && b.area === fa) { const mm = blockMin(b); faPlan += mm; if (isDone(k, b.id)) faDone += mm; } });
    if (core && bl.some(b => b.id === core.id)) { coreTotal++; if (isDone(k, core.id)) coreDays++; }
  });
  const en = weekEnergy(mon);
  const label = {0: 'Bu hafta', '-1': 'Geçen hafta', 1: 'Gelecek hafta'}[S.weekOff] || (S.weekOff < 0 ? `${-S.weekOff} hafta önce` : `${S.weekOff} hafta sonra`);
  let h = `<header class="head">${top(label)}<div class="weekbar"><button class="nav" type="button" data-act="weekPrev" aria-label="Önceki hafta">${SVG('<path d="m15 6-6 6 6 6"/>')}</button>
    <h1>${mon.getDate()} ${MON_S[mon.getMonth()]} – ${sun.getDate()} ${MON_S[sun.getMonth()]}</h1>
    <button class="nav" type="button" data-act="weekNext" aria-label="Sonraki hafta">${SVG('<path d="m9 6 6 6-6 6"/>')}</button></div></header>`;
  h += `<div class="strip" role="group" aria-label="Günler">${keys.map((k, i) => {
    const d = parse(k), c = dayCount(k, d), p = c.total ? c.done / c.total * 100 : 0;
    return `<button class="sd${k === sel ? ' is-sel' : ''}${k === tkey ? ' is-today' : ''}" type="button" data-act="pickDay" data-date="${k}" aria-pressed="${k === sel}" aria-label="${DOW_L[i + 1]} ${d.getDate()}">
      <span class="sd-w">${DOW_S[i + 1]}</span><span class="sd-n">${d.getDate()}</span><span class="sd-bar">${k > tkey ? '' : `<i style="width:${p}%"></i>`}</span></button>`;
  }).join('')}</div>`;
  h += `<section class="stats">
      <div class="stat"><span class="k">${esc(fa ? areaLabel(fa) : 'Odak alanı')}</span><span class="v">${nf1.format(faDone / 60)} <small>/ ${nf1.format(faPlan / 60)} sa</small></span></div>
      <div class="stat"><span class="k">${esc(core ? core.title : 'Temel blok')}</span><span class="v">${core ? coreDays : '–'} <small>/ ${core ? coreTotal : 7} gün</small></span></div>
      <div class="stat"><span class="k">Enerji ort.</span><span class="v">${en ? nf1.format(en.avg) : '–'} <small>/ 5</small></span></div></section>`;

  const d = parse(sel), w = dow(d), dd = dayDoc(sel), bl = blocksFor(d), tasks = S.tasks.filter(t => t.due === sel).sort(byOrder), c = dayCount(sel, d);
  const onlyDaily = bl.every(b => b.dow === 0), future = sel > tkey;
  h += `<section class="card"><div class="card-head"><h2>${DOW_L[w]}, ${d.getDate()} ${MON_L[d.getMonth()]}</h2>
      <div class="pills">${sel === tkey ? '<span class="pill">Bugün</span>' : ''}${dd.bad ? '<span class="pill warn">Kötü gün</span>' : ''}${future ? '' : `<span class="count">${c.done}/${c.total}</span>`}</div></div>
    ${onlyDaily ? `<p class="note">${core ? `Boş akşam. Sadece ${esc(core.title)}.` : 'Akşam programı yok.'}</p>` : ''}
    <div class="tl">${bl.map(b => blockRow(b, sel, dd.bad, future)).join('')}</div>
    ${tasks.length ? `<div class="day-tasks">${tasks.map(t => taskRow(t)).join('')}</div>` : ''}
    <button class="add-inline" type="button" data-act="add" data-due="${sel}">+ Bu güne iş ekle</button></section>`;

  const rv = S.weeks[monKey];
  h += `<section class="card review"><div class="card-head"><h2>Haftalık değerlendirme</h2><button class="link" type="button" data-act="review" data-week="${monKey}">${rv ? 'Düzenle' : 'Yaz'}</button></div>
    ${rv && (rv.good || rv.stuck || rv.next) ? `<dl>${rv.good ? `<div><dt>İyi giden</dt><dd>${esc(rv.good)}</dd></div>` : ''}${rv.stuck ? `<div><dt>Takılan</dt><dd>${esc(rv.stuck)}</dd></div>` : ''}${rv.next ? `<div><dt>Gelecek haftanın önceliği</dt><dd>${esc(rv.next)}</dd></div>` : ''}</dl>`
      : '<p class="note">Pazar, 15 dk: ne iyi gitti, nerede takıldın, gelecek haftanın 3 önceliği.</p>'}</section>`;
  h += `<button class="ghost" type="button" data-act="tplEdit">${SVG('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>')}Haftalık şablonu düzenle</button>`;
  return h;
}

function viewTemplate() {
  let h = `<header class="head">${top('Hafta')}<div class="hero"><div><h1>Şablon</h1><p class="sub">Her blok, o günün programında işaretlenebilir bir satır olur.</p></div>
    <button class="primary" type="button" data-act="tplDone">Bitti</button></div></header>`;
  for (let n = 0; n <= 7; n++) {
    const bl = sortBlocks(S.routine.filter(b => b.dow === n)), tot = bl.reduce((s, b) => s + blockMin(b), 0);
    h += `<section class="card"><div class="card-head"><h2>${n === 0 ? 'Her gün' : DOW_L[n]}</h2><span class="count">${tot ? fmtDur(tot) : ''}</span></div>
      ${bl.map(b => `<div class="row"><button class="row-main" type="button" data-act="editBlock" data-id="${esc(b.id)}"><span class="row-title">${esc(b.title)}</span>
        <span class="row-meta"><b>${esc(b.start ? (b.end ? `${b.start}–${b.end}` : b.start) : 'Gün içi')}</b><span class="sep">·</span>${dot(b.area)}${esc(areaLabel(b.area))}${b.core ? '<span class="sep">·</span>her koşulda' : ''}</span></button></div>`).join('')}
      <button class="add-inline" type="button" data-act="addBlock" data-dow="${n}">+ Blok ekle</button></section>`;
  }
  return h;
}

function viewPlan() {
  const d = today(), n = planMonths(), ps0 = planStart(), m = planMonth(d), ps = phases(), fp = focusPhase(), c = cfg();
  const gates = ps.filter(p => Number(p.gateMonth) >= 1).sort((a, b) => a.gateMonth - b.gateMonth);
  const gateSet = new Set(gates.map(p => Number(p.gateMonth)));
  const end = new Date(ps0.getFullYear(), ps0.getMonth() + n - 1, 1);
  let h = `<header class="head">${top(esc(c.planEyebrow || `${n} aylık plan`))}<div class="hero"><div><h1>${esc(c.planTitle || 'Plan')}</h1>${c.planSub ? `<p class="sub">${esc(c.planSub)}</p>` : ''}</div></div></header>`;
  const meX = m < 1 ? 0 : m > n ? 100 : (m - .5) / n * 100;
  h += `<section class="card"><div class="card-head"><h2>Rota</h2><span class="count">${m < 1 ? `${ps0.getDate()} ${MON_L[ps0.getMonth()]} ${ps0.getFullYear()}’${locSuf(ps0.getFullYear())} başlıyor` : m > n ? 'Tamamlandı' : `Ay ${m} / ${n}`}</span></div>
    <div class="track-wrap"><span class="me" style="left:clamp(40px, ${meX.toFixed(2)}%, calc(100% - 40px))">${m < 1 ? 'Başlangıç' : 'Buradasın'}</span>
      <div class="track" style="grid-template-columns:repeat(${n}, minmax(0,1fr))" role="img" aria-label="${n} ayın ${Math.max(0, Math.min(n, m))}. ayı">${Array.from({length: n}, (_, i) => {
        const k = i + 1; return `<span class="tick${gateSet.has(k) ? ' gt' : ''}${k < m ? ' past' : k === m ? ' now' : ''}"></span>`; }).join('')}</div></div>
    <div class="track-ends"><span>${MON_S[ps0.getMonth()]} ${ps0.getFullYear()}</span><span>${MON_S[end.getMonth()]} ${end.getFullYear()}</span></div>
    ${gates.length ? `<div class="stops" style="grid-template-columns:repeat(${Math.min(gates.length, 4)}, minmax(0,1fr))">${gates.map(p => `<div class="stop">${stamp(phaseDone(p))}<strong>${esc(p.gateShort || '')}</strong></div>`).join('')}</div>` : ''}</section>`;

  const mt = S.metrics || {}, sav = Number(mt.savingsEur) || 0, tgt = Number(mt.savingsTarget) || 0, cli = Number(mt.clients) || 0, cliT = Number(mt.clientsTarget) || 3;
  const inc = mt.income && typeof mt.income === 'object' ? mt.income : {}, it = Number(mt.incomeTarget) || 0;
  const meets = v => v != null && v !== '' && (it ? Number(v) >= it : Number(v) > 0);
  const months = [2, 1, 0].map(k => new Date(d.getFullYear(), d.getMonth() - k, 1));
  let streak = 0;
  for (let k = 0; k < 24; k++) {
    const v = inc[monthKey(new Date(d.getFullYear(), d.getMonth() - k, 1))];
    if (meets(v)) streak++; else if (k > 0 || v != null) break;
  }
  h += `<section class="card"><div class="card-head"><h2>Kapı göstergeleri</h2><button class="link" type="button" data-act="metrics">Güncelle</button></div>
    <div class="metric" style="padding-top:4px"><div class="m-top"><span class="k">Birikim</span><span class="v">${nf.format(sav)} €${tgt ? ` <small>/ ${nf.format(tgt)} €</small>` : ''}</span></div>
      ${tgt ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, sav / tgt * 100)).toFixed(1)}%"></i><b style="left:25%"></b><b style="left:50%"></b><b style="left:75%"></b></div>
      <div class="ticks"><span style="left:25%">%25</span><span style="left:50%">%50</span><span style="left:75%">%75</span></div>` : ''}</div>
    <div class="metric pair"><div><span class="k">Ödeme yapan müşteri</span><span class="v">${nf.format(cli)} <small>/ ${nf.format(cliT)}</small></span></div>
      <div><span class="k">Eşik üstü ay, üst üste</span><span class="v">${streak} <small>/ 3</small></span></div></div>
    <div class="metric"><span class="k">${esc(incLabel())}${it ? ` · eşik ${nf.format(it)} €/ay` : ''}</span>
      <div class="months">${months.map(x => { const v = inc[monthKey(x)]; return `<div class="mo${meets(v) ? ' ok' : ''}"><span class="k">${MON_S[x.getMonth()]} ${x.getFullYear()}</span><span class="v">${v != null && v !== '' ? nf.format(Number(v) || 0) + ' €' : '–'}</span></div>`; }).join('')}</div></div>
  </section>`;

  ps.forEach(p => {
    const ts = tasksOf(p.id), tasks = ts.filter(t => t.kind !== 'gate'), gts = ts.filter(t => t.kind === 'gate');
    const open = S.open[p.id] ?? (fp && p.id === fp.id), complete = phaseDone(p), dn = tasks.filter(t => t.done).length;
    h += `<section class="phase${complete ? ' is-complete' : ''}"><button class="phase-head" type="button" data-act="phase" data-id="${esc(p.id)}" aria-expanded="${!!open}">
      <span class="ph-no">${esc(String(p.no ?? '').replace(/\D/g, ''))}</span>
      <span class="ph-t"><strong>${esc(p.title)}</strong><small>${esc(p.label)} · Ay ${esc(p.start === p.end ? p.start : `${p.start}–${p.end}`)}</small>
        <span class="ph-prog"><i style="width:${tasks.length ? dn / tasks.length * 100 : 0}%"></i></span></span>
      <span class="ph-r">${dn}/${tasks.length}${CHEV}</span></button>
      ${open ? `<div class="phase-body">${tasks.map(t => taskRow(t, {note: true})).join('')}
        <button class="add-inline" type="button" data-act="add" data-phase="${esc(p.id)}">+ İş ekle</button>
        ${gts.length ? `<div class="gate"><div class="gate-head">${stamp(complete, true)}<div><p class="eyebrow">Kapı</p><strong>${esc(p.gateLabel || '')}</strong></div></div>${gts.map(t => taskRow(t)).join('')}</div>` : ''}
      </div>` : ''}</section>`;
  });
  return h;
}

function viewList() {
  const k = todayKey(), open = S.tasks.filter(t => !t.done);
  const late = open.filter(t => t.due && t.due < k).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const now = open.filter(t => t.due === k).sort(byOrder);
  const soon = open.filter(t => t.due && t.due > k).sort((a, b) => String(a.due).localeCompare(String(b.due)) || byOrder(a, b));
  const inbox = open.filter(t => !t.due && !t.phase).sort(byOrder);
  const done = S.tasks.filter(t => t.done).sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''))).slice(0, 12);
  const sec = (title, list, empty) => `<section class="card"><div class="card-head"><h2>${title}</h2><span class="count">${list.length}</span></div>
    ${list.length ? list.map(t => taskRow(t, {note: true})).join('') : `<p class="empty">${empty}</p>`}</section>`;
  let h = `<header class="head">${top(`${open.length} açık iş`)}<div class="hero"><div><h1>Liste</h1><p class="sub">Aşama işleri Plan’da. Burada tarihli işler, gelen kutusu ve fikirler.</p></div></div></header>`;
  if (late.length) h += sec('Gecikenler', late, '');
  h += sec('Bugün', now, 'Bugüne tarihli iş yok.');
  h += sec('Yaklaşanlar', soon, 'Tarihli iş yok.');
  h += sec('Gelen kutusu', inbox, 'Boş. + ile hızlıca iş ekle, aşamasını sonra seç.');
  const ideas = [...S.ideas].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  h += `<section class="card"><div class="card-head"><h2>Fikir defteri</h2><button class="link" type="button" data-act="addIdea">Fikir ekle</button></div>
    <p class="note">Proje limiti: 1 para + 1 tutku. Yeni fikir plana girmez, burada bekler.</p>
    ${ideas.length ? ideas.map(i => `<div class="row"><div class="row-main"><span class="row-title">${esc(i.text)}</span><span class="row-meta">${i.createdAt ? esc(shortDate(String(i.createdAt).slice(0, 10))) : ''}</span></div>
      <button class="mini" type="button" data-act="delIdea" data-id="${esc(i.id)}">Sil</button></div>`).join('') : '<p class="empty">Henüz fikir yok.</p>'}</section>`;
  if (done.length) h += `<section class="card"><div class="card-head"><h2>Son bitenler</h2><span class="count">${S.tasks.filter(t => t.done).length} toplam</span></div>${done.map(t => taskRow(t)).join('')}</section>`;
  return h;
}

const emptyView = () => `<header class="head">${top('Rota 2028')}<div class="hero"><div><h1>Plan verisi henüz yok</h1>
  <p class="sub">Program, aşamalar ve işler yüklenince burada görünecek. İlk işi + ile ekleyebilirsin.</p></div></div></header>`;

/* ---------- çizim ---------- */
let raf = 0;
const render = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
function draw() {
  S.lastKey = todayKey();
  document.querySelectorAll('.tab').forEach(b => b.dataset.tab === S.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (!S.running || !S.got.tasks || !S.got.routine || !S.got.phases) return;
  const v = $('#view');
  S.akeys = null;
  v.innerHTML = (!S.tasks.length && !S.routine.length && !S.phases.length) ? emptyView()
    : ({bugun: viewToday, hafta: viewWeek, plan: viewPlan, liste: viewList}[S.tab] || viewToday)();
  v.removeAttribute('aria-busy');
  if (S.enter) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); S.enter = false; }
  S.pop = null;
  if (S.action === 'add') { S.action = null; openAdd({}); }
}

/* ---------- veri ---------- */
function write(path, fn) {
  let p;
  try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
  return p.then(() => true, e => {
    console.warn('Rota: kaydedilemedi', path, e);
    toast(e && e.code === 'unavailable' ? 'Oturum kapalı, kaydedilmedi.' : 'Kaydedilemedi.');
    return false;
  });
}
function upsert(path, patch, base) {
  return write(path, async () => {
    const ref = db.doc(path), snap = await ref.get();
    if (snap.exists) await ref.update(patch); else await ref.set({...base, ...patch});
  });
}
// Ekranda hemen göster; depo anlık görüntüsü aynı mikro görevde yerine geçer.
function localDay(k, patch) {
  const cur = dayDoc(k);
  S.days = {...S.days, [k]: {...cur, date: k, ...patch, done: {...(cur.done || {}), ...(patch.done || {})}}};
  render();
}
function localTask(id, patch) { S.tasks = S.tasks.map(t => t.id === id ? {...t, ...patch} : t); render(); }
function listen() {
  const fail = name => e => { console.warn('Rota: dinleyici durdu', name, e); toast('Veri okunamadı. Uygulamayı yeniden aç.'); };
  const col = (name, key) => db.collection(name).onSnapshot(s => { S[key] = s.docs.map(x => ({id: x.id, ...x.data()})); S.got[key] = true; S.akeys = null; render(); }, fail(name));
  col('tasks', 'tasks'); col('routine', 'routine'); col('phases', 'phases'); col('ideas', 'ideas');
  db.collection('weeks').onSnapshot(s => { const o = {}; s.docs.forEach(x => { o[x.id] = x.data(); }); S.weeks = o; render(); }, fail('weeks'));
  db.collection('days').orderBy('date', 'desc').limit(150).onSnapshot(s => { const o = {}; s.docs.forEach(x => { o[x.id] = x.data(); }); S.days = o; render(); }, fail('days'));
  db.doc('metrics/main').onSnapshot(s => { S.metrics = s.exists ? s.data() : null; render(); }, fail('metrics'));
  db.doc('settings/app').onSnapshot(s => { S.settings = s.exists ? s.data() : null; S.akeys = null; render(); }, fail('settings'));
}

/* ---------- geçmiş (Android geri tuşu) ---------- */
const H = {sheet: false, skip: 0};
const saveTab = () => { try { localStorage.setItem('rota-tab', S.tab); } catch (e) { /* önemsiz */ } };
function initNav() {
  const q = new URLSearchParams(location.search), st = history.state;
  let tab = S.tab;
  if (st && TABS.includes(st.tab)) tab = st.tab;
  if (TABS.includes(q.get('tab'))) tab = q.get('tab');
  if (q.get('action') === 'add') S.action = 'add';
  const clean = location.pathname;
  try {
    if (tab === 'bugun') history.replaceState(null, '', clean);
    else if (st && st.tab) history.replaceState({tab}, '', clean);   // yenileme: alttaki Bugün kaydı duruyor
    else { history.replaceState(null, '', clean); history.pushState({tab}, '', clean); }
  } catch (e) { /* geçmiş API kapalı */ }
  S.tab = tab; saveTab();
}
function goTab(t) {
  if (!TABS.includes(t) || (t === S.tab && !S.tplEdit)) return;
  if (t !== S.tab) {
    const st = history.state;
    try {
      if (t === 'bugun') { if (st && st.tab) { H.skip++; history.back(); } }
      else if (st && st.tab) history.replaceState({tab: t}, '');
      else history.pushState({tab: t}, '');
    } catch (e) { /* önemsiz */ }
  }
  S.tab = t; S.tplEdit = false; S.enter = true; saveTab(); draw(); window.scrollTo(0, 0);
}
addEventListener('popstate', e => {
  if (H.skip > 0) { H.skip--; return; }
  if (!$('#sheetWrap').hidden) { closeSheet(true); return; }
  const t = e.state && TABS.includes(e.state.tab) ? e.state.tab : 'bugun';
  if (t !== S.tab || S.tplEdit) { S.tab = t; S.tplEdit = false; S.enter = true; saveTab(); draw(); window.scrollTo(0, 0); }
});

/* ---------- alt sayfa ve bildirim ---------- */
function openSheet(html, focusSel, name = '') {
  const wrap = $('#sheetWrap'), sh = $('#sheet'), wasOpen = !wrap.hidden;
  sh.innerHTML = html; S.sheet = name; wrap.hidden = false; document.body.style.overflow = 'hidden'; document.body.classList.add('sheet-open');
  const h2 = sh.querySelector('.sheet-head h2');
  sh.setAttribute('aria-label', h2 ? h2.textContent : 'Form');
  sh.scrollTop = 0;
  if (!wasOpen) {
    try { history.pushState({tab: (history.state && history.state.tab) || null, sheet: 1}, ''); H.sheet = true; } catch (e) { H.sheet = false; }
  }
  if (focusSel) { const f = sh.querySelector(focusSel); if (f) f.focus(); }
  else if (!wasOpen) sh.focus({preventScroll: true});
}
function closeSheet(fromPop) {
  const wrap = $('#sheetWrap');
  if (wrap.hidden) return;
  wrap.hidden = true; $('#sheet').innerHTML = ''; S.sheet = ''; document.body.style.overflow = ''; document.body.classList.remove('sheet-open');
  if (!fromPop && H.sheet) { H.sheet = false; H.skip++; history.back(); }
  else H.sheet = false;
}
let toastT = 0, waitingSW = null;
function toast(msg, opt) {
  const o = typeof opt === 'function' ? {label: 'Geri al', fn: opt} : (opt || {});
  const t = $('#toast');
  S.toastFn = o.fn || null;
  t.innerHTML = `<span>${esc(msg)}</span>${o.fn ? `<button type="button" class="toast-btn" data-act="toastAct">${esc(o.label || 'Tamam')}</button>` : ''}`;
  t.hidden = false; t.dataset.kind = o.kind || '';
  clearTimeout(toastT);
  if (!o.sticky) toastT = setTimeout(hideToast, o.ms || (o.fn ? 4500 : 2200));
}
function hideToast() {
  const t = $('#toast');
  t.hidden = true; S.toastFn = null;
  if (waitingSW && t.dataset.kind !== 'update') setTimeout(() => { if (t.hidden && waitingSW) showUpdateToast(); }, 400);
}
const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* desteklenmiyor */ } };
const head = title => `<div class="sheet-head"><h2>${title}</h2><button type="button" class="link" data-act="closeSheet">Kapat</button></div>`;
const modeSwitch = m => `<div class="mode" role="group" aria-label="Tür"><button type="button" data-act="modeTask" aria-pressed="${m === 'task'}">İş</button><button type="button" data-act="modeIdea" aria-pressed="${m === 'idea'}">Fikir</button></div>`;
const sundayKey = () => iso(addDays(today(), (7 - dow(today())) % 7));
function dateChips(v) {
  const opts = [['', 'Tarihsiz'], [todayKey(), 'Bugün'], [iso(addDays(today(), 1)), 'Yarın'], [sundayKey(), 'Pazar']];
  return opts.map(([k, l]) => `<button type="button" class="chip" data-act="setDue" data-v="${k}" aria-pressed="${(v || '') === k}">${l}</button>`).join('');
}
function areaOpts(sel) {
  const keys = [...areaKeys()];
  if (sel && !keys.includes(sel)) keys.push(sel);
  if (!keys.length) return '<option value="">Alan yok</option>';
  return keys.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(areaLabel(v))}</option>`).join('');
}

/* Ortak form parçaları (giriş ekranları da kullanır) */
function pwField(id, label, ac, hint) {
  return `<div class="fld"><label for="${id}">${esc(label)}</label><div class="pw"><input id="${id}" name="${id}" type="password" autocomplete="${ac}" minlength="${ac === 'new-password' ? 10 : 1}" required autocapitalize="none" spellcheck="false">
    <button type="button" class="pw-toggle" data-pw="${id}" aria-label="Şifreyi göster" aria-pressed="false">${EYE}</button></div>${hint ? `<small class="fld-hint">${esc(hint)}</small>` : ''}</div>`;
}
function busy(btn, on) {
  if (!btn) return;
  btn.disabled = !!on; btn.classList.toggle('busy', !!on);
  if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pw]');
  if (!b) return;
  const i = document.getElementById(b.dataset.pw);
  if (!i) return;
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
  b.innerHTML = show ? EYE_OFF : EYE;
});

function taskForm(t) {
  const isNew = !t, p = S.preset;
  t = t || {title: '', note: '', due: p.due || '', phase: p.phase || '', area: defaultArea(), who: 'ben', kind: 'task'};
  return `<form id="f-task" data-id="${isNew ? '' : esc(t.id)}" autocomplete="off">${head(isNew ? 'Yeni iş' : 'İşi düzenle')}${isNew ? modeSwitch('task') : ''}
    <label class="fld"><span>Ne yapılacak?</span><input class="big" id="f-title" name="title" required maxlength="200" value="${esc(t.title)}" placeholder="Örn. Teklif metnini bitir"></label>
    <div class="fld"><span>Tarih</span><div class="chips">${dateChips(t.due)}</div><input type="date" id="f-due" name="due" value="${esc(t.due || '')}" aria-label="Tarih seç"></div>
    <div class="grid2"><label class="fld"><span>Aşama</span><select id="f-phase" name="phase"><option value="">Gelen kutusu</option>${phases().map(x => `<option value="${esc(x.id)}"${x.id === t.phase ? ' selected' : ''}>${esc(x.no)}: ${esc(x.title)}</option>`).join('')}</select></label>
      <label class="fld"><span>Alan</span><select id="f-area" name="area">${areaOpts(t.area)}</select></label></div>
    <div class="fld"><span>Kim</span><div class="seg">${Object.entries(whoMap()).map(([v, l]) => `<label><input type="radio" name="who" value="${v}"${(t.who || 'ben') === v ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></div>
    <label class="check"><input type="checkbox" id="f-gate" name="gate"${t.kind === 'gate' ? ' checked' : ''}> Kapı şartı (aşamanın geçiş koşulu)</label>
    <label class="fld"><span>Not</span><textarea id="f-note" name="note" rows="2" maxlength="1000">${esc(t.note || '')}</textarea></label>
    <div class="actions">${isNew ? '' : `<button type="button" class="danger" data-act="delTask" data-id="${esc(t.id)}">Sil</button>`}<button type="submit" class="primary">Kaydet</button></div></form>`;
}
const ideaForm = () => `<form id="f-idea" autocomplete="off">${head('Yeni fikir')}${modeSwitch('idea')}
  <p class="note">Proje limiti: 1 para + 1 tutku. Fikir burada bekler, plana girmez.</p>
  <label class="fld"><span>Fikir</span><textarea id="i-text" name="text" rows="3" required maxlength="1000"></textarea></label>
  <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
function blockForm(b, presetDow) {
  const isNew = !b;
  b = b || {title: '', dow: presetDow ?? 1, start: '20:00', end: '21:00', area: defaultArea(), core: false, min: ''};
  return `<form id="f-block" data-id="${isNew ? '' : esc(b.id)}" autocomplete="off">${head(isNew ? 'Yeni blok' : 'Bloğu düzenle')}
    <label class="fld"><span>Ne?</span><input class="big" id="b-title" name="title" required maxlength="120" value="${esc(b.title)}"></label>
    <div class="grid2"><label class="fld"><span>Gün</span><select id="b-dow" name="dow">${[0, 1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}"${b.dow === n ? ' selected' : ''}>${n === 0 ? 'Her gün' : DOW_L[n]}</option>`).join('')}</select></label>
      <label class="fld"><span>Alan</span><select id="b-area" name="area">${areaOpts(b.area)}</select></label></div>
    <div class="grid2"><label class="fld"><span>Başlangıç</span><input type="time" id="b-start" name="start" value="${esc(b.start || '')}"></label>
      <label class="fld"><span>Bitiş</span><input type="time" id="b-end" name="end" value="${esc(b.end || '')}"></label></div>
    <label class="fld"><span>Süre, dk (saat girilmediyse)</span><input type="number" id="b-min" name="min" min="0" step="5" inputmode="numeric" value="${esc(b.min || '')}"></label>
    <label class="check"><input type="checkbox" id="b-core" name="core"${b.core ? ' checked' : ''}> Kötü günde de yapılır</label>
    <div class="actions">${isNew ? '' : `<button type="button" class="danger" data-act="delBlock" data-id="${esc(b.id)}">Sil</button>`}<button type="submit" class="primary">Kaydet</button></div></form>`;
}
function reviewForm(monKey) {
  const r = S.weeks[monKey] || {}, mon = parse(monKey), sun = addDays(mon, 6), en = weekEnergy(mon);
  return `<form id="f-review" data-week="${esc(monKey)}">${head('Haftalık değerlendirme')}
    <p class="note">${mon.getDate()} ${MON_S[mon.getMonth()]} – ${sun.getDate()} ${MON_S[sun.getMonth()]} · enerji ortalaması ${en ? nf1.format(en.avg) : '–'} / 5</p>
    <label class="fld"><span>Ne iyi gitti?</span><textarea id="r-good" name="good" rows="2" maxlength="2000">${esc(r.good || '')}</textarea></label>
    <label class="fld"><span>Nerede takıldım?</span><textarea id="r-stuck" name="stuck" rows="2" maxlength="2000">${esc(r.stuck || '')}</textarea></label>
    <label class="fld"><span>Gelecek haftanın 3 önceliği</span><textarea id="r-next" name="next" rows="3" maxlength="2000">${esc(r.next || '')}</textarea></label>
    <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
}
function metricsForm() {
  const mt = S.metrics || {}, d = today(), inc = mt.income || {}, it = Number(mt.incomeTarget) || 0;
  const ms = Array.from({length: 6}, (_, k) => new Date(d.getFullYear(), d.getMonth() - k, 1));
  return `<form id="f-metrics">${head('Göstergeleri güncelle')}
    <label class="fld"><span>Birikim, toplam (€)</span><input type="number" id="m-sav" name="sav" min="0" step="1" inputmode="decimal" value="${esc(mt.savingsEur ?? 0)}"></label>
    <label class="fld"><span>Ödeme yapan müşteri sayısı</span><input type="number" id="m-cli" name="cli" min="0" step="1" inputmode="numeric" value="${esc(mt.clients ?? 0)}"></label>
    <div class="grid2"><label class="fld"><span>Ay</span><select id="m-month" name="month">${ms.map(x => `<option value="${monthKey(x)}">${MON_L[x.getMonth()]} ${x.getFullYear()}</option>`).join('')}</select></label>
      <label class="fld"><span>${esc(incLabel())} (€)</span><input type="number" id="m-inc" name="inc" min="0" step="1" inputmode="decimal" placeholder="Girilmedi" value="${esc(inc[monthKey(d)] ?? '')}"></label></div>
    <p class="note">O ayın toplam net geliri.${it ? ` Eşik ${nf.format(it)} €/ay.` : ''}</p>
    <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
}

/* ---------- ayarlar ---------- */
let bip = null;   // beforeinstallprompt olayı
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const updateCard = () => waitingSW ? '<div class="set-card"><div class="set-sync"><strong>Yeni sürüm hazır</strong><small>Yenileyince en son sürüm açılır.</small></div><button class="btn2" type="button" data-act="applyUpdate"><span>Yenile</span></button></div>' : '';
const installBtn = () => bip && !standalone() ? '<button class="primary block" type="button" data-act="install">Uygulamayı yükle</button>' : '';
// Ayarlar açıkken yalnız ilgili parça yenilenir; sayfanın geri kalanı (ör. kurulmuş Çıkış düğmesi) bozulmaz.
function refreshSettingsExtras() {
  if (S.sheet !== 'settings') return;
  const u = $('#setUpdate'), i = $('#setInstall');
  if (u) u.innerHTML = updateCard();
  if (i) i.innerHTML = installBtn();
}
function settingsSheet() {
  const email = (S.user && S.user.email) || '', [l1, l2] = syncText(S.sync), st = syncState(S.sync);
  return `${head('Ayarlar')}
    <div class="acct"><span class="avatar" aria-hidden="true">${esc(initial())}</span><div class="acct-t"><span class="k">Hesap</span><strong>${esc(email)}</strong></div></div>
    <div class="set-card"><i class="sync-dot s-${st}" id="setDot" aria-hidden="true"></i><div class="set-sync" role="status"><strong id="setLine">${esc(l1)}</strong><small id="setSub">${esc(l2)}</small></div>
      <button class="btn2${S.sync && S.sync.syncing ? ' busy' : ''}" type="button" data-act="syncNow" id="syncBtn"><span>Şimdi eşitle</span></button></div>
    <div id="setUpdate">${updateCard()}</div><div id="setInstall">${installBtn()}</div>
    <div class="set-list">
      <button class="set-row" type="button" data-act="pwSheet"><span>Şifreyi değiştir</span>${CHEV_R}</button>
      <button class="set-row out" type="button" data-act="logout"><span>Çıkış yap</span></button>
    </div>
    <p class="set-warn" id="logoutWarn" role="alert" hidden></p>
    <p class="ver">Rota 2028 · sürüm ${esc(VERSION)}</p>`;
}
function pwSheet() {
  const email = (S.user && S.user.email) || '';
  return `<form id="f-pw" novalidate>${head('Şifreyi değiştir')}
    <input class="vh" type="email" name="username" autocomplete="username" value="${esc(email)}" tabindex="-1" aria-hidden="true" readonly>
    ${pwField('p-new', 'Yeni şifre', 'new-password', 'En az 10 karakter.')}
    ${pwField('p-new2', 'Yeni şifre, tekrar', 'new-password')}
    <p class="form-err" id="p-err" role="alert" hidden></p>
    <div class="actions"><button type="submit" class="primary" id="p-btn"><span>Kaydet</span></button></div></form>`;
}
let logoutT = 0;
function logoutTap(el) {
  if (el.dataset.armed) { doLogout(el); return; }
  const n = (S.sync && S.sync.pending) || 0, w = $('#logoutWarn');
  el.dataset.armed = '1'; el.classList.add('armed');
  el.firstElementChild.textContent = n ? 'Yine de çık' : 'Emin misin? Çık';
  if (w && n) { w.textContent = `${n} değişiklik henüz eşitlenmedi. Çıkarsan bu cihazdan silinir.`; w.hidden = false; }
  clearTimeout(logoutT);
  logoutT = setTimeout(() => {
    if (!el.isConnected) return;
    delete el.dataset.armed; el.classList.remove('armed'); el.firstElementChild.textContent = 'Çıkış yap';
    if (w) w.hidden = true;
  }, 4000);
}
async function doLogout(el) {
  clearTimeout(logoutT);
  busy(el, true);
  const id = S.user && S.user.id;
  // Önce eşitleme durur ve yerel veri silinir, sonra oturum kapanır.
  try { if (id) await window.RotaSync.clear(id); } catch (e) { /* önemsiz */ }
  try { await window.RotaAuth.signOut(); } catch (e) { /* yerel oturum yine silinir */ }
  try { localStorage.removeItem('rota-tab'); history.replaceState(null, '', location.pathname); } catch (e) { /* önemsiz */ }
  location.replace(location.pathname);
}

/* ---------- yükleme (PWA) ---------- */
const flag = k => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
const setFlag = k => { try { localStorage.setItem(k, '1'); } catch (e) { /* önemsiz */ } };
function showInstall() {
  const el = $('#install');
  if (!bip || !S.running || standalone() || flag('rota-install-dismissed') || !el.hidden) return;
  el.innerHTML = `<img src="icons/icon-192.png" alt="" width="40" height="40"><div class="install-t"><b>Rota’yı yükle</b><small>Tam ekran açılır, internetsiz de çalışır.</small></div>
    <button class="mini" type="button" data-act="install">Yükle</button><button class="x-btn" type="button" data-act="installClose" aria-label="Kapat">${X_ICON}</button>`;
  el.hidden = false; document.body.classList.add('has-install');
}
function hideInstall() { const el = $('#install'); el.hidden = true; el.innerHTML = ''; document.body.classList.remove('has-install'); }
async function installApp() {
  const p = bip;
  if (!p) return;
  bip = null; hideInstall(); setFlag('rota-install-dismissed');
  try { await p.prompt(); await p.userChoice; } catch (e) { /* kullanıcı vazgeçti */ }
  refreshSettingsExtras();
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); bip = e;
  showInstall();
  refreshSettingsExtras();
});
addEventListener('appinstalled', () => { bip = null; hideInstall(); refreshSettingsExtras(); setFlag('rota-install-dismissed'); toast('Uygulama yüklendi.'); });

/* ---------- service worker ve güncelleme ---------- */
let wantReload = false, reloading = false;
function showUpdateToast() { if (waitingSW) toast('Yeni sürüm hazır', {label: 'Yenile', fn: applyUpdate, sticky: true, kind: 'update'}); }
function applyUpdate() {
  if (!waitingSW) { location.reload(); return; }
  wantReload = true;
  waitingSW.postMessage({type: 'SKIP_WAITING'});
  setTimeout(() => { if (!reloading) { reloading = true; location.reload(); } }, 4000);
}
function initSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(reg => {
    const onWaiting = w => { waitingSW = w; showUpdateToast(); refreshSettingsExtras(); };
    if (reg.waiting && navigator.serviceWorker.controller) onWaiting(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) onWaiting(w); });
    });
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && navigator.onLine && Date.now() - lastCheck > 30 * 60000) { lastCheck = Date.now(); reg.update().catch(() => {}); }
    });
  }).catch(e => console.warn('Rota: service worker kaydedilemedi', e));
}

/* ---------- olaylar ---------- */
function arm(el, label, fn) {
  if (el.dataset.armed) { fn(); return; }
  el.dataset.armed = '1'; el.classList.add('armed'); const old = el.textContent; el.textContent = label;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.classList.remove('armed'); el.textContent = old; } }, 3500);
}
function toggleTask(task) {
  const id = task.id, v = !task.done, patch = {done: v, doneAt: v ? todayKey() : null}, back = {done: !!task.done, doneAt: task.doneAt ?? null};
  if (v) { S.pop = id; buzz(); }
  localTask(id, patch);
  write('tasks/' + id, () => db.doc('tasks/' + id).update(patch));
  if (v) toast('Tamamlandı', () => { localTask(id, back); write('tasks/' + id, () => db.doc('tasks/' + id).update(back)); });
}
function openAdd(ds) {
  const due = ds.due || (!ds.phase && S.tab === 'bugun' ? todayKey() : !ds.phase && S.tab === 'hafta' && S.selDay ? S.selDay : '');
  S.preset = {phase: ds.phase || '', due};
  openSheet(taskForm(null), '#f-title', 'task');
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const a = el.dataset.act, id = el.dataset.id;
  const task = id ? S.tasks.find(t => t.id === id) : null;
  switch (a) {
    case 'tab': goTab(el.dataset.tab); break;
    case 'add': openAdd(el.dataset); break;
    case 'modeTask': openSheet(taskForm(null), '#f-title', 'task'); break;
    case 'modeIdea': case 'addIdea': openSheet(ideaForm(), '#i-text', 'idea'); break;
    case 'editTask': if (task) openSheet(taskForm(task), null, 'task'); break;
    case 'toggleTask': if (task) toggleTask(task); break;
    case 'pullToday': if (task) { localTask(id, {due: todayKey()}); write('tasks/' + id, () => db.doc('tasks/' + id).update({due: todayKey()})); toast('Bugüne alındı'); } break;
    case 'toggleBlock': {
      const k = el.dataset.date, v = !isDone(k, id);
      if (v) { S.pop = k + ':' + id; buzz(); }
      localDay(k, {done: {[id]: v}}); upsert('days/' + k, {done: {[id]: v}}, {date: k}); break;
    }
    case 'setBad': { const k = el.dataset.date, v = el.dataset.v === '1'; if (!!dayDoc(k).bad !== v) { localDay(k, {bad: v}); upsert('days/' + k, {bad: v}, {date: k, done: {}}); } break; }
    case 'energy': { const k = el.dataset.date, n = Number(el.dataset.n), v = dayDoc(k).energy === n ? 0 : n; localDay(k, {energy: v}); upsert('days/' + k, {energy: v}, {date: k, done: {}}); break; }
    case 'review': openSheet(reviewForm(el.dataset.week), null, 'review'); break;
    case 'pickDay': S.selDay = el.dataset.date; draw(); break;
    case 'weekPrev': S.weekOff = Math.max(-20, S.weekOff - 1); S.selDay = null; draw(); break;
    case 'weekNext': S.weekOff = Math.min(12, S.weekOff + 1); S.selDay = null; draw(); break;
    case 'tplEdit': S.tplEdit = true; S.enter = true; draw(); window.scrollTo(0, 0); break;
    case 'tplDone': S.tplEdit = false; S.enter = true; draw(); break;
    case 'editBlock': { const b = S.routine.find(x => x.id === id); if (b) openSheet(blockForm(b), null, 'block'); break; }
    case 'addBlock': openSheet(blockForm(null, Number(el.dataset.dow)), '#b-title', 'block'); break;
    case 'phase': { const fp = focusPhase(); S.open[id] = !(S.open[id] ?? (fp && fp.id === id)); draw(); break; }
    case 'metrics': openSheet(metricsForm(), null, 'metrics'); break;
    case 'delIdea': arm(el, 'Emin misin?', () => write('ideas/' + id, () => db.doc('ideas/' + id).delete())); break;
    case 'delTask': if (task) arm(el, 'Emin misin? Sil', () => {
      const {id: _x, ...copy} = task; closeSheet();
      S.tasks = S.tasks.filter(t => t.id !== id); render();
      write('tasks/' + id, () => db.doc('tasks/' + id).delete());
      toast('Silindi', () => write('tasks/' + id, () => db.doc('tasks/' + id).set(copy)));
    }); break;
    case 'delBlock': arm(el, 'Emin misin? Sil', () => { closeSheet(); write('routine/' + id, () => db.doc('routine/' + id).delete()).then(ok => ok && toast('Silindi')); }); break;
    case 'setDue': $('#f-due').value = el.dataset.v; el.parentElement.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === el))); break;
    case 'toastAct': { const fn = S.toastFn; clearTimeout(toastT); hideToast(); if (fn) fn(); break; }
    case 'closeSheet': closeSheet(); break;
    case 'settings': openSheet(settingsSheet(), null, 'settings'); break;
    case 'syncNow': {
      if (!navigator.onLine) { toast('İnternet yok. Bağlantı gelince eşitlenir.'); break; }
      el.classList.add('busy');
      window.RotaSync.flush().then(st => {
        if (el.isConnected) el.classList.remove('busy');
        toast(st.pending ? `${st.pending} değişiklik bekliyor` : st.error ? 'Eşitlenemedi. Kendiliğinden yeniden denenecek.' : 'Eşitlendi');
      });
      break;
    }
    case 'pwSheet': openSheet(pwSheet(), '#p-new', 'password'); break;
    case 'logout': logoutTap(el); break;
    case 'install': installApp(); break;
    case 'installClose': setFlag('rota-install-dismissed'); hideInstall(); break;
    case 'applyUpdate': applyUpdate(); break;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'f-due') document.querySelectorAll('#f-task [data-act="setDue"]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.v === e.target.value)));
});
document.addEventListener('change', e => {
  if (e.target.id === 'm-month') { const inc = (S.metrics || {}).income || {}; $('#m-inc').value = inc[e.target.value] ?? ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });
document.addEventListener('submit', e => {
  const f = e.target;
  if (!f.closest('#sheet')) return;   // giriş formları auth.js'te
  e.preventDefault();
  const fd = new FormData(f), str = k => String(fd.get(k) ?? '').trim();
  if (f.id === 'f-task') {
    const title = str('title'); if (!title) return;
    const data = {title, note: str('note'), due: str('due') || null, phase: str('phase') || null, area: str('area') || defaultArea(), who: str('who') || 'ben', kind: fd.get('gate') ? 'gate' : 'task'};
    const id = f.dataset.id; closeSheet();
    if (id) { localTask(id, data); write('tasks/' + id, () => db.doc('tasks/' + id).update(data)).then(ok => ok && toast('Kaydedildi')); }
    else write('tasks/new', () => db.collection('tasks').add({...data, done: false, doneAt: null, createdAt: new Date().toISOString(), order: Date.now()})).then(ok => ok && toast('Eklendi'));
  } else if (f.id === 'f-idea') {
    const text = str('text'); if (!text) return; closeSheet();
    write('ideas/new', () => db.collection('ideas').add({text, createdAt: new Date().toISOString()})).then(ok => ok && toast('Fikir defterine eklendi'));
  } else if (f.id === 'f-block') {
    const title = str('title'); if (!title) return;
    const data = {title, dow: Number(str('dow')), start: str('start'), end: str('end'), area: str('area') || defaultArea(), min: Number(str('min')) || 0, core: !!fd.get('core')};
    const id = f.dataset.id; closeSheet();
    if (id) write('routine/' + id, () => db.doc('routine/' + id).update(data)).then(ok => ok && toast('Kaydedildi'));
    else write('routine/new', () => db.collection('routine').add({...data, order: Date.now()})).then(ok => ok && toast('Eklendi'));
  } else if (f.id === 'f-review') {
    const w = f.dataset.week; closeSheet();
    upsert('weeks/' + w, {good: str('good'), stuck: str('stuck'), next: str('next'), updatedAt: new Date().toISOString()}, {week: w}).then(ok => ok && toast('Kaydedildi'));
  } else if (f.id === 'f-metrics') {
    const incRaw = str('inc');
    const patch = {savingsEur: Math.max(0, Number(str('sav')) || 0), clients: Math.max(0, Math.round(Number(str('cli')) || 0)),
      income: {[str('month')]: incRaw === '' ? null : Math.max(0, Number(incRaw) || 0)}};
    closeSheet();
    upsert('metrics/main', patch, {}).then(ok => ok && toast('Kaydedildi'));
  } else if (f.id === 'f-pw') {
    const a = $('#p-new').value, b = $('#p-new2').value, er = $('#p-err'), btn = $('#p-btn');
    const fail = m => { er.textContent = m; er.hidden = false; };
    if (a.length < 10) return fail('Şifre en az 10 karakter olmalı.');
    if (a !== b) return fail('Şifreler aynı değil.');
    if (!navigator.onLine) return fail('İnternet yok. Şifre değiştirmek için bağlantı gerekli.');
    er.hidden = true; busy(btn, true);
    window.RotaAuth.updatePassword(a).then(() => { closeSheet(); toast('Şifre güncellendi.'); }, err => { busy(btn, false); fail(window.RotaAuth.pwError(err)); });
  }
});

// Şimdi kartı her dakika güncellenir; gün değişince her şey yeniden çizilir.
function tick() {
  if (S.running && (S.tab === 'bugun' || todayKey() !== S.lastKey)) render();
  if (S.sheet === 'settings') syncUI();
}
setTimeout(() => { tick(); setInterval(tick, 60000); }, 60000 - (Date.now() % 60000) + 50);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.running) render(); });
addEventListener('offline', () => { if (S.running) toast('Çevrimdışı. Değişiklikler cihazda saklanıyor.'); });
addEventListener('online', () => {
  if (!S.running) return;
  window.RotaSync.flush().then(st => { if (st.online && !st.pending && !st.error) toast('Bağlantı geldi. Eşitlendi.'); });
});

/* ---------- dışa açık ---------- */
window.RotaUI = Object.freeze({esc, pwField, busy, toast});
window.RotaApp = Object.freeze({
  start(user, client) {
    if (S.running) return;
    S.running = true; S.user = user; db = window.RotaDB;
    S.sync = window.RotaSync.status();
    window.RotaSync.onStatus(st => { S.sync = st; syncUI(); });
    window.RotaSync.start({client, userId: user.id}).catch(e => console.warn('Rota: eşitleme başlatılamadı', e));
    initNav();
    listen();
    draw();
    showInstall();
  },
  running: () => S.running,
  userId: () => S.user && S.user.id,
  setUser(u) { if (S.running && u && S.user && u.id === S.user.id) S.user = u; },
});
draw();
initSW();
})();
