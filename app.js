/* Rota arayüzü: Bugün, Hafta, Plan, Liste. Görünümler RotaDB anlık görüntülerinden çizilir;
   her yazma yerelde hemen uygulanır, eşitleme arka planda RotaSync ile yürür.
   Ortak alan varsa plan, aşamalar, ortak işler, göstergeler, fikirler ve haftalık değerlendirmeler ortaklarla paylaşılır;
   günlük program, günler, özel işler ve kişisel ayarlar (prefs) kullanıcıya özel kalır. */
(() => {
'use strict';
const DOW_L = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const DOW_S = ['', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MON_L = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MON_S = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const TABS = ['bugun', 'hafta', 'plan', 'liste'];
const DEF_WHO = {ben: 'Ben', ortak: 'Ortak', ikimiz: 'İkimiz'};
const DEF_START = '2026-11-01', DEF_MONTHS = 24;
const SHARED = ['tasks', 'phases', 'ideas', 'weeks', 'metrics', 'settings'];
const CURRENCIES = ['$', '€', '₺'];
const VERSION = String(self.APP_VERSION || '');
// Hatırlatma sunucusu (Supabase Edge Function): VAPID anahtarı, deneme bildirimi.
const FN_URL = 'https://ywwigizfvrcsljgjcqfe.supabase.co/functions/v1/rota-remind';
const nf = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 0});
const nf1 = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1});
const SVG = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHEV = SVG('<path d="m6 9 6 6 6-6"/>');
const CHEV_R = SVG('<path d="m9 6 6 6-6 6"/>');
const X_ICON = SVG('<path d="M6 6l12 12M18 6 6 18"/>');
const EYE = SVG('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', 1.8);
const FLAME = SVG('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-2.9 1.8-4.9 3.4-6.6.3 1.6 1.1 2.8 2.3 3.4-.2-3.3 1.3-6.2 3.7-8.1.2 2.6 1.4 4.4 2.7 6 1 1.3 1.9 2.8 1.9 5.1 0 3.8-3.1 6.4-7.5 6.4z"/>', 1.9);
const BELL = SVG('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0"/>', 1.9);
const EYE_OFF = SVG('<path d="M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.9M6.3 7.3C3.9 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 1.8);

const S = {tasks: [], shTasks: [], myTasks: [], routine: [], phases: [], ideas: [], days: {}, weeks: {}, metrics: null, settings: null, prefs: null, got: {},
  tab: 'bugun', weekOff: 0, tplEdit: false, open: {}, preset: {}, lastKey: '', pop: null, enter: false,
  toastFn: null, user: null, running: false, sync: null, action: null, sheet: '', akeys: null, cfgC: null,
  space: null, me: null, spaceName: '', listFilter: 'all', client: null, gx: null, openDays: {}, push: {sub: null, checked: false}};
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
const fromMin = n => { n = ((Math.round(n) % 1440) + 1440) % 1440; return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; };
const addMin = (t, m) => fromMin(toMin(t) + m);
const taskMin = t => Math.max(5, Number(t.min) || 30);
function dueLabel(key) {
  const diff = Math.round((parse(key) - today()) / 864e5);
  if (diff === 0) return ['Bugün', ''];
  if (diff === 1) return ['Yarın', ''];
  if (diff < 0) return [`${-diff} gün gecikti`, 'late'];
  return [shortDate(key), ''];
}
function greeting() { const h = new Date().getHours(); return h < 5 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : h < 23 ? 'İyi akşamlar' : 'İyi geceler'; }

/* ---------- ayarlar (ortak settings/app + kişisel prefs/app) ---------- */
// Kişisel ayarlar ortak olanın üstüne yazılır; alan (area) listeleri birleşir.
function cfg() {
  if (S.cfgC) return S.cfgC;
  const s = S.settings || {}, p = S.prefs || {};
  const areas = {...(isObj(s.areas) ? s.areas : {}), ...(isObj(p.areas) ? p.areas : {})};
  const order = [...(Array.isArray(s.areaOrder) ? s.areaOrder : []), ...(Array.isArray(p.areaOrder) ? p.areaOrder : [])];
  return (S.cfgC = {...s, ...p, areas, areaOrder: [...new Set(order)]});
}
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
const currency = () => CURRENCIES.includes(cfg().currency) ? cfg().currency : '€';
const money = v => `${nf.format(Number(v) || 0)} ${currency()}`;
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

/* ---------- ortaklar ----------
   Ortak alanda "kim" alanı kalıcı üye anahtarı tutar (ör. mehmet, yasin, ikimiz); "ben" ve "ortak" eski tek kişilik
   kayıtlardan kalır ve bakan kişiye göre çözülür. */
const shared = () => !!S.space;
function members() { const m = (S.settings || {}).members; return isObj(m) ? m : {}; }
const partners = () => Object.keys(members()).filter(k => k !== S.me);
const partner = () => partners()[0] || '';
const isMe = k => !k || k === 'ben' || (!!S.me && k === S.me);
const normWho = k => !shared() ? (k || 'ben') : (!k || k === 'ben') ? S.me : k === 'ortak' ? (partner() || k) : k;
function whoLabel(k) {
  if (!shared()) return whoMap()[k] || String(k);
  const w = normWho(k);
  if (w === 'ikimiz') return 'İkimiz';
  if (w === S.me) return 'Ben';
  return members()[w] || cap(String(w));
}
const memberName = k => members()[k] || (k === S.me ? 'Ben' : cap(String(k || '')));
// İş bana mı düşüyor: özel işler, bana atananlar ve ikimizinkiler.
const forMe = t => t._mine || isMe(normWho(t.who)) || t.who === 'ikimiz';
const forPartner = t => !t._mine && shared() && (partners().includes(normWho(t.who)) || t.who === 'ikimiz');
function whoOptions() {
  if (!shared()) return Object.entries(whoMap());
  return [[S.me, 'Ben'], ...partners().map(k => [k, memberName(k)]), ['ikimiz', 'İkimiz']];
}
const taskPath = t => `${t._col || 'tasks'}/${t.id}`;

/* ---------- yardımcılar ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const byOrder = (a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
const fmtDur = m => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} sa${r ? ` ${r} dk` : ''}` : `${r} dk`; };
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
// Satır altı kısa açıklama: "Ne:" etiketi ve boş etiketler ("Nasıl:" + madde listesi) atılır.
const brief = s => lines(s).map(l => l.replace(/^[-•]\s+/, '').replace(/^Ne:\s*/, '')).filter(l => !/^[^:]{2,24}:$/.test(l)).join(' · ');
// Açıklama metni: her satır paragraf, "- " ile başlayan satırlar madde, "Nasıl:" gibi kısa etiketler kalın.
function richText(s) {
  let h = '', ul = false;
  for (const l of lines(s)) {
    if (/^[-•]\s+/.test(l)) { if (!ul) { h += '<ul>'; ul = true; } h += `<li>${esc(l.replace(/^[-•]\s+/, ''))}</li>`; continue; }
    if (ul) { h += '</ul>'; ul = false; }
    const m = l.match(/^([^:]{2,24}):\s*(.*)$/);
    h += m && !/https?$/i.test(m[1]) ? `<p><b>${esc(m[1])}:</b>${m[2] ? ' ' + esc(m[2]) : ''}</p>` : `<p>${esc(l)}</p>`;
  }
  return ul ? h + '</ul>' : h;
}
function blockMin(b) { return b.start && b.end ? Math.max(0, toMin(b.end) - toMin(b.start)) : Number(b.min) || 0; }
const sortKey = b => b.start || (b.dow === 0 ? '00:00' : '23:59');
const sortBlocks = list => list.sort((a, b) => String(sortKey(a)).localeCompare(String(sortKey(b))) || byOrder(a, b));
const blocksFor = d => { const w = dow(d); return sortBlocks(S.routine.filter(b => b.dow === 0 || b.dow === w)); };
const dayDoc = key => S.days[key] || {};
const isDone = (key, id) => !!((dayDoc(key).done || {})[id]);
/* Bir günün maddeleri: program blokları ve bana düşen o tarihli işler. Saati bir bloğun içine düşen iş o bloğun
   altında görünür (ör. 20:15–22:00 Ajans bloğunun içindeki 20:15 ve 21:05 işleri). Her gün blokları (alışkanlıklar) iş barındırmaz. */
function dayPlan(key, o = {}) {
  const dd = dayDoc(key);
  const blocks = blocksFor(parse(key)).filter(b => !o.noHabits || b.dow !== 0).map(b => {
    const mm = blockMin(b);
    return {k: 'b', id: b.id, b, title: b.title, note: b.note || '', area: b.area, start: b.start || '', end: b.end || (b.start && mm ? addMin(b.start, mm) : ''),
      mins: mm, done: isDone(key, b.id), dim: !!dd.joker || (!!dd.bad && !b.core), habit: b.dow === 0, core: !!b.core, kids: []};
  });
  const tasks = S.tasks.filter(t => forMe(t) && t.due === key).sort(byOrder).map(t => ({k: 't', id: t.id, t, title: t.title, note: t.note || '', area: t.area,
    start: t.time || '', end: t.time ? addMin(t.time, taskMin(t)) : '', mins: t.time || t.min ? taskMin(t) : 0, done: !!t.done, dim: false, kids: []}));
  const loose = [];
  tasks.forEach(it => {
    const host = it.start && blocks.find(b => !b.habit && b.start && b.end && toMin(b.start) <= toMin(it.start) && toMin(it.start) < toMin(b.end));
    (host ? host.kids : loose).push(it);
  });
  const st = (a, b) => toMin(a.start) - toMin(b.start) || (a.k === b.k ? 0 : a.k === 'b' ? -1 : 1);
  blocks.forEach(b => b.kids.sort(st));
  const all = [...blocks, ...loose];
  return {timed: all.filter(x => x.start).sort(st), untimed: all.filter(x => !x.start), blocks, tasks, dd};
}
function dayCount(key) {
  const p = dayPlan(key), items = [...p.blocks.filter(b => !b.dim), ...p.tasks];
  return {total: items.length, done: items.filter(x => x.done).length};
}
/* Göreve boş saat: o günün (tercihen aynı alandaki) bloğunda ilk boşluk. Blok yoksa ya da doluysa akşam penceresinde
   (20:15–22:00) hiçbir blok ve işle çakışmayan ilk boşluk. Yer yoksa boş döner: iş "Saati yok" altında görünür. Bugünse geçmiş saat verilmez. */
function suggestSlot(key, mins, area, skipId) {
  const p = dayPlan(key), floor = key === todayKey() ? Math.ceil((nowMin() + 1) / 5) * 5 : 0;
  const span = x => [toMin(x.start), Math.max(toMin(x.end || x.start), toMin(x.start) + 1)];
  const tasks = p.tasks.filter(x => x.id !== skipId && x.start).map(span);
  const fit = (from, to, busy) => {
    let t = Math.max(from, floor);
    for (const [s, e] of [...busy].sort((a, b) => a[0] - b[0])) if (s < t + mins && e > t) t = e;
    return t + mins <= to ? t : -1;
  };
  const hosts = p.blocks.filter(b => !b.habit && !b.dim && b.start && b.end && !b.b.review)
    .sort((a, b) => (b.area === area) - (a.area === area) || toMin(a.start) - toMin(b.start));
  for (const b of hosts) { const t = fit(toMin(b.start), toMin(b.end), tasks); if (t >= 0) return fromMin(t); }
  const all = [...tasks, ...p.blocks.filter(b => !b.dim && b.start).map(span)];
  const t = fit(toMin(cfg().taskSlot || '20:15'), toMin(cfg().taskSlotEnd || '22:00'), all);
  return t >= 0 ? fromMin(t) : '';
}
const phases = () => [...S.phases].sort(byOrder);
// Ortak alanda her ortağın haftalık değerlendirmesi ayrı belgedir: aynı anda yazınca birbirini ezmez.
const reviewId = (monKey, who = S.me) => shared() ? `${monKey}_${who}` : monKey;
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
/* ---------- puan, seviye, zincir, ödül ----------
   Puan kayıtlardan hesaplanır (geri alınca düşer). "Tam gün" o gün kapanınca gün belgesine işlenir: sonradan programa
   blok eklemek geçmiş günlerin puanını değiştirmesin. Ödüller ve harcamalar kişisel ayarlarda (prefs) durur. */
const XP = {block: 10, task: 20, gate: 50, full: 25, review: 30};
const MILES = [[3, 15], [7, 30], [14, 60], [30, 150], [60, 300], [100, 500]];
const lvlAt = n => 50 * n * (n - 1);   // seviye n'in başladığı toplam puan: 1→0, 2→100, 3→300, 4→600, 5→1000
const levelOf = xp => { let n = 1; while (lvlAt(n + 1) <= xp) n++; return n; };
const RANKS = [[20, 'Üstat'], [15, 'Usta'], [10, 'Kalfa'], [5, 'Çırak'], [1, 'Acemi']];
const rankOf = n => (RANKS.find(([m]) => n >= m) || RANKS[RANKS.length - 1])[1];
const habits = () => sortBlocks(S.routine.filter(b => b.dow === 0 && !b.review));
const DEF_REWARDS = [
  {id: 'w-kahve', title: 'Sevdiğin bir kahve ya da tatlı', cost: 200},
  {id: 'w-dizi', title: 'Suçluluk duymadan bir bölüm dizi ya da film', cost: 300},
  {id: 'w-joker', title: 'Joker: bu akşam izin, zincirler kırılmaz', cost: 600, joker: true},
  {id: 'w-kitap', title: 'Yeni bir kitap', cost: 1200},
  {id: 'w-hediye', title: 'Kendine bir hediye (en çok 500 TL)', cost: 3000},
];
const rewards = () => Array.isArray((S.prefs || {}).rewards) ? S.prefs.rewards : DEF_REWARDS;
const spentList = () => Array.isArray((S.prefs || {}).spent) ? S.prefs.spent : [];
const mineDone = t => !!t.done && (t.doneBy ? t.doneBy === S.me : forMe(t));
// Zincir: üst üste yapılan günler. Kötü gün ("her koşulda" değilse), joker gün ve henüz bitmemiş bugün zinciri kırmaz.
function streakOf(h) {
  const tk = todayKey(), r = {cur: 0, best: 0, bonus: 0, total: 0};
  const ks = Object.keys(S.days).filter(k => k <= tk && (S.days[k].done || {})[h.id]).sort();
  if (!ks.length) return r;
  let run = 0;
  for (let d = parse(ks[0]), end = parse(tk); d <= end; d = addDays(d, 1)) {
    const k = iso(d), dd = S.days[k] || {};
    if ((dd.done || {})[h.id]) { run++; r.total++; if (run > r.best) r.best = run; const m = MILES.find(([n]) => n === run); if (m) r.bonus += m[1]; }
    else if (dd.joker || (dd.bad && !h.core) || k === tk) continue;
    else run = 0;
  }
  r.cur = run;
  return r;
}
function game() {
  if (S.gx) return S.gx;
  const tk = todayKey();
  let blocks = 0, full = 0, tasks = 0, gates = 0, reviews = 0, bonus = 0;
  for (const [k, dd] of Object.entries(S.days)) {
    if (k > tk) continue;
    blocks += Object.values(dd.done || {}).filter(Boolean).length;
    if (dd.full) full++;
  }
  S.tasks.forEach(t => { if (mineDone(t)) { if (t.kind === 'gate') gates++; else tasks++; } });
  Object.entries(S.weeks).forEach(([id, w]) => { if ((shared() ? id.endsWith('_' + S.me) : !id.includes('_')) && w && (w.good || w.stuck || w.next)) reviews++; });
  const streaks = new Map();
  habits().forEach(h => { const s = streakOf(h); streaks.set(h.id, s); bonus += s.bonus; });
  const xp = blocks * XP.block + full * XP.full + tasks * XP.task + gates * XP.gate + reviews * XP.review + bonus;
  const spent = spentList().reduce((s, x) => s + (Number(x.cost) || 0), 0), level = levelOf(xp), base = lvlAt(level);
  return (S.gx = {xp, level, rank: rankOf(level), into: xp - base, need: lvlAt(level + 1) - base, balance: xp - spent, spent, streaks, blocks, full, tasks, gates, reviews});
}
function dayXP(keys) {
  let x = 0;
  keys.forEach(k => { const dd = S.days[k] || {}; x += Object.values(dd.done || {}).filter(Boolean).length * XP.block + (dd.full ? XP.full : 0); });
  S.tasks.forEach(t => { if (mineDone(t) && keys.includes(t.doneAt)) x += t.kind === 'gate' ? XP.gate : XP.task; });
  return x;
}
// Günün her maddesi bittiyse "tam gün" işlenir, biri geri alınırsa kalkar.
function syncFull(key) {
  if (!key || key > todayKey()) return;
  const c = dayCount(key), full = c.total > 0 && c.done === c.total;
  if (full !== !!dayDoc(key).full) { localDay(key, {full}); upsert('days/' + key, {full}, {date: key, done: {}}); }
}
function floatXP(el, n) {
  if (!el || !el.getBoundingClientRect) return;
  const r = el.getBoundingClientRect(), f = document.createElement('span');
  f.className = 'xp-float'; f.textContent = `+${n}`; f.setAttribute('aria-hidden', 'true');
  f.style.left = `${Math.round(r.left + r.width / 2)}px`; f.style.top = `${Math.round(r.top)}px`;
  document.body.appendChild(f); setTimeout(() => f.remove(), 1100);
}
function levelUp(g) {
  const o = document.createElement('div');
  o.className = 'lvlup'; o.setAttribute('role', 'status');
  o.innerHTML = `<div class="lvlup-in"><small>Seviye atladın</small><b>${g.level}</b><span>${esc(g.rank)}</span></div>`;
  document.body.appendChild(o); setTimeout(() => o.remove(), 2300);
  try { if (navigator.vibrate) navigator.vibrate([20, 60, 30]); } catch (e) { /* desteklenmiyor */ }
}
// Bir işaretlemeden sonra: kazanılan puanı uçur, zincir eşiği ve seviye atlama varsa kutla. Dönen değer: kazanılan puan.
function reward(before, el, habitId) {
  S.gx = null;
  const g = game(), gain = g.xp - before.xp;
  if (gain > 0) floatXP(el, gain);
  if (g.level > before.level) levelUp(g);
  else if (habitId && gain > 0) {
    const s = g.streaks.get(habitId), m = s && MILES.find(([n]) => n === s.cur), h = S.routine.find(b => b.id === habitId);
    if (m && h) toast(`${h.title}: ${s.cur} günlük zincir · +${m[1]} bonus`, {ms: 3200});
  }
  return gain;
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
const initial = () => { const e = (shared() && members()[S.me]) || (S.user && S.user.email) || ''; return e ? e.charAt(0).toLocaleUpperCase('tr-TR') : 'R'; };
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
const whoChip = t => {
  if (t._mine && shared()) return '<span class="who priv">Özel</span>';
  if (t.who && !isMe(normWho(t.who)) && !(t.done && t.doneBy && normWho(t.who) === t.doneBy)) return `<span class="who">${esc(whoLabel(t.who))}</span>`;
  return '';
};
function taskRow(t, o = {}) {
  const [dl, cls] = t.due ? dueLabel(t.due) : ['', ''];
  const meta = [`${dot(t.area)}${esc(t.area ? areaLabel(t.area) : 'Kişisel')}`];
  if (dl && !t.done) meta.push(`<span class="${cls}">${esc(dl)}${t.time && cls !== 'late' ? ` ${esc(t.time)}` : ''}</span>`);
  if (t.min && !t.done) meta.push(fmtDur(t.min));
  const wc = whoChip(t); if (wc) meta.push(wc);
  if (t.done && shared() && t.doneBy && t.doneBy !== S.me) meta.push(`<span class="by">${esc(memberName(t.doneBy))} bitirdi</span>`);
  const desc = o.note !== false && t.note && !t.done ? `<span class="row-desc">${esc(brief(t.note))}</span>` : '';
  return `<div class="row${t.done ? ' is-done' : ''}${t.kind === 'gate' ? ' is-gate' : ''}">
    <button class="chk${S.pop === t.id ? ' pop' : ''}" type="button" data-act="toggleTask" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${esc(t.title)}"></button>
    <button class="row-main" type="button" data-act="detail" data-k="t" data-id="${esc(t.id)}"><span class="row-title">${esc(t.title)}</span>${desc}
      <span class="row-meta">${meta.join('<span class="sep">·</span>')}</span></button>
    ${o.pull ? `<button class="mini" type="button" data-act="pullToday" data-id="${esc(t.id)}">Bugüne al</button>` : ''}
  </div>`;
}
/* Zaman çizelgesi satırı: blok (yuvarlak kutu) ya da iş (kare kutu); bloğun içine düşen işler altında girintili. */
function itemMeta(it) {
  const m = [`${dot(it.area)}${esc(it.area ? areaLabel(it.area) : 'Kişisel')}`];
  if (it.mins) m.push(fmtDur(it.mins));
  if (it.k === 'b' && it.habit) { const s = game().streaks.get(it.id); if (s && s.cur) m.push(`<span class="flame" title="Zincir">${FLAME}${s.cur}</span>`); }
  if (it.k === 'b' && it.core) m.push('her koşulda');
  if (it.k === 't') { const wc = whoChip(it.t); if (wc) m.push(wc); }
  return `<span class="row-meta">${m.join('<span class="sep">·</span>')}</span>`;
}
const chkFor = (it, key, locked) => it.k === 'b'
  ? `<button class="chk round${S.pop === key + ':' + it.id ? ' pop' : ''}" type="button" data-act="toggleBlock" data-id="${esc(it.id)}" data-date="${key}" aria-pressed="${it.done}" aria-label="${esc(it.title)}"${locked || it.dim ? ' disabled' : ''}></button>`
  : `<button class="chk${S.pop === it.id ? ' pop' : ''}" type="button" data-act="toggleTask" data-id="${esc(it.id)}" aria-pressed="${it.done}" aria-label="${esc(it.title)}"></button>`;
function itemRow(it, key, locked) {
  const time = it.start ? `<span class="tl-time">${esc(it.start)}${it.end ? `<small>${esc(it.end)}</small>` : ''}</span>` : '<span class="tl-time any">SAATSİZ</span>';
  const desc = it.note && !it.done ? `<span class="row-desc">${esc(brief(it.note))}</span>` : '';
  const body = it.k === 'b' && it.b.review
    ? `<button class="tl-body" type="button" data-act="review" data-week="${iso(monday(parse(key)))}"><span class="row-title">${esc(it.title)}</span>${desc}${itemMeta(it)}<span class="row-link">Değerlendirmeyi yaz</span></button>`
    : `<button class="tl-body" type="button" data-act="detail" data-k="${it.k}" data-id="${esc(it.id)}" data-date="${key}"><span class="row-title">${esc(it.title)}</span>${desc}${itemMeta(it)}</button>`;
  const kids = it.kids.length ? `<div class="kids">${it.kids.map(c => `<div class="kid${c.done ? ' is-done' : ''}">${chkFor(c, key)}
    <button class="kid-body" type="button" data-act="detail" data-k="t" data-id="${esc(c.id)}" data-date="${key}"><span class="kid-time">${esc(c.start)}–${esc(c.end)} · ${fmtDur(c.mins)}</span>
      <span class="row-title">${esc(c.title)}</span>${c.note && !c.done ? `<span class="row-desc">${esc(brief(c.note))}</span>` : ''}</button></div>`).join('')}</div>` : '';
  return `<div class="tl-row${it.done ? ' is-done' : ''}${it.dim ? ' is-dim' : ''}${it.k === 't' ? ' is-task' : ''}">${time}${chkFor(it, key, locked)}<div class="tl-main">${body}${kids}</div></div>`;
}
const stamp = (ok, big) => `<span class="stamp${ok ? ' ok' : ''}${big ? ' big' : ''}" role="img" aria-label="${ok ? 'Kapı geçildi' : 'Kapı bekliyor'}">${ok ? 'GEÇTİ' : 'KAPI'}</span>`;

/* ---------- Şimdi kartı ---------- */
/* Şimdi kartı: şu an yapılacak tek şey, açıklamasıyla. Bloğun açık işi varsa kart bloğu değil işi gösterir. */
function nowCard(key, plan) {
  const mins = nowMin(), dd = plan.dd, leaves = [];
  plan.timed.forEach(it => {
    if (it.dim) return;
    it.kids.forEach(c => leaves.push({...c, host: it}));
    if (!it.kids.some(c => !c.done)) leaves.push(it);
  });
  const end = x => x.end ? toMin(x.end) : toMin(x.start) + (x.mins || 15);
  const open = leaves.filter(x => !x.done);
  const cur = open.filter(x => toMin(x.start) <= mins && mins < end(x)).sort((a, b) => (a.k === b.k ? toMin(b.start) - toMin(a.start) : a.k === 't' ? -1 : 1))[0];
  const ups = open.filter(x => toMin(x.start) > mins).sort((a, b) => toMin(a.start) - toMin(b.start));
  const late = open.filter(x => end(x) <= mins);
  const card = (eb, it, meta, pct, after) => {
    const btn = it ? `<button class="now-btn" type="button" data-act="${it.k === 'b' ? 'toggleBlock' : 'toggleTask'}" data-id="${esc(it.id)}" data-date="${key}">Bitti</button>` : '';
    const title = it ? it.title : meta.title, d = it && it.note ? `<p class="now-desc">${esc(brief(it.note))}</p>` : '';
    const inner = `<h2 class="now-title">${esc(title)}</h2>${meta.text ? `<p class="now-meta">${esc(meta.text)}</p>` : ''}${d}`;
    return `<section class="now" aria-label="Şimdi"><div class="now-top"><p class="now-eb">${esc(eb)}</p>${btn}</div>
      ${it ? `<button class="now-body" type="button" data-act="detail" data-k="${it.k}" data-id="${esc(it.id)}" data-date="${key}">${inner}</button>` : inner}
      ${pct != null ? `<div class="now-bar"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>` : ''}
      ${after ? `<p class="now-next">Sonra · ${esc(after.start)} ${esc(after.title)}</p>` : ''}</section>`;
  };
  const span = x => `${x.start}${x.end ? `–${x.end}` : ''}`;
  if (cur) {
    const s = toMin(cur.start), e = end(cur);
    return card(`Şu an${cur.host ? ` · ${cur.host.title}` : ''}`, cur, {text: `${span(cur)} · ${fmtDur(e - mins)} kaldı`}, (mins - s) / Math.max(1, e - s) * 100, ups[0]);
  }
  if (ups.length) { const n = ups[0]; return card(`Sıradaki · ${fmtDur(toMin(n.start) - mins)} sonra`, n, {text: `${span(n)}${n.mins ? ` · ${fmtDur(n.mins)}` : ''}`}, null, ups[1]); }
  if (late.length) return card(`Kaldı · ${late.length} madde`, late[0], {text: `${span(late[0])} · saati geçti. Yaptıysan işaretle.`}, null, late[1]);
  if (!plan.timed.length && !plan.untimed.length) return card('Bugün', null, {title: 'Program yok.', text: 'Şablona blok ekle ya da + ile iş ekle.'});
  const why = dd.joker ? 'Joker gün: bu akşam izin. ' : dd.bad ? 'Kötü gün, telafi yok. ' : '';
  return card('Bugün', null, {title: 'Program tamam.', text: `${why}Bugün +${nf.format(dayXP([key]))} puan. Yarın devam.`});
}

/* ---------- görünümler ---------- */
// Seviye şeridi: seviye, ilerleme, cüzdan. Dokununca puan ve ödüller açılır.
function levelBar(g, todayGain) {
  const p = g.need ? g.into / g.need * 100 : 0;
  return `<button class="lvl" type="button" data-act="rewards" aria-label="Seviye ${g.level}, ${g.xp} puan. Puan ve ödüller">
    <span class="lvl-no" aria-hidden="true">${g.level}</span>
    <span class="lvl-t"><strong>Seviye ${g.level} · ${esc(g.rank)}</strong><span class="lvl-bar"><i style="width:${p.toFixed(1)}%"></i></span>
      <small>${nf.format(g.into)} / ${nf.format(g.need)} puan${todayGain ? ` · bugün +${nf.format(todayGain)}` : ''}</small></span>
    <span class="lvl-w"><b>${nf.format(Math.max(0, g.balance))}</b><small>cüzdan</small></span></button>`;
}
const coreTitles = () => sortBlocks(S.routine.filter(b => b.core)).map(b => b.title);
function viewToday() {
  const d = today(), key = iso(d), w = dow(d), dd = dayDoc(key), fp = focusPhase(), plan = dayPlan(key), c = dayCount(key), g = game();
  const tot = plan.blocks.filter(b => !b.dim).reduce((s, b) => s + b.mins, 0) + plan.tasks.filter(t => !plan.blocks.some(b => b.kids.includes(t))).reduce((s, t) => s + t.mins, 0);
  let h = `<header class="head">${top(greeting())}<div class="hero with-ring"><div><h1>${DOW_L[w]}</h1><p class="sub">${d.getDate()} ${MON_L[d.getMonth()]} · ${monthLine(d)}</p></div>${ring(c.done, c.total)}</div></header>`;
  h += levelBar(g, dayXP([key]));
  h += nowCard(key, plan);
  if (energyRule()) h += `<div class="banner"><strong>Enerji kuralı</strong>Enerji iki haftadır 2/5 ya da altında. Bu hafta ara ver, plan bir hafta kayar.</div>`;
  h += notifyPrompt();

  h += `<section class="card"><div class="card-head"><h2>Bugünün planı</h2><span class="count">${tot ? fmtDur(tot) : ''}</span></div>
    ${plan.timed.length ? `<div class="tl">${plan.timed.map(it => itemRow(it, key)).join('')}</div>` : '<p class="empty">Bugün için saatli madde yok.</p>'}
    ${plan.untimed.length ? `<p class="sub-h">Saati yok</p><div class="tl">${plan.untimed.map(it => itemRow(it, key)).join('')}</div>
      <p class="hint">Saat ver: maddeye dokun, Düzenle. Sıralama ve hatırlatma saate göre çalışır.</p>` : ''}
    <button class="add-inline" type="button" data-act="add" data-due="${key}">+ Bugüne iş ekle</button></section>`;

  const late = S.tasks.filter(t => forMe(t) && !t.done && t.due && t.due < key).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  if (late.length) h += `<section class="card"><div class="card-head"><h2>Gecikenler</h2><span class="count">${late.length}</span></div>${late.map(t => taskRow(t, {pull: true})).join('')}</section>`;

  const ct = coreTitles(), only = ct.length ? ct.join(', ') : 'her koşulda yapılan bloklar';
  const lit = n => dd.energy && n <= dd.energy && n !== dd.energy ? ' lit' : '';
  h += `<section class="card"><div class="card-head"><h2>Günün durumu</h2>${dd.joker ? '<span class="pill">Joker</span>' : ''}</div>
    <div class="segc" role="group" aria-label="Gün türü"><button type="button" data-act="setBad" data-v="0" data-date="${key}" aria-pressed="${!dd.bad}">Normal gün</button>
      <button type="button" class="bad" data-act="setBad" data-v="1" data-date="${key}" aria-pressed="${!!dd.bad}">Kötü gün</button></div>
    <p class="hint">${dd.bad ? `Sadece şunlar sayılır: ${esc(only)}. Telafi yok, diğer zincirler kırılmaz.` : `Zor bir günse kötü günü seç. Sadece şunlar sayılır: ${esc(only)}.`}</p>
    <div class="energy"><div class="energy-l"><b>Enerji</b><small>1 düşük, 5 yüksek</small></div>
      ${[1, 2, 3, 4, 5].map(n => `<button class="en${lit(n)}" type="button" data-act="energy" data-date="${key}" data-n="${n}" aria-pressed="${dd.energy === n}" aria-label="Enerji ${n}">${n}</button>`).join('')}</div>
  </section>`;

  if (fp) {
    const next = tasksOf(fp.id).filter(t => !t.done && !t.due && t.kind !== 'gate' && forMe(t)).slice(0, 4);
    h += `<section class="card"><div class="card-head"><h2>Sıradaki işler</h2><span class="count">${esc(fp.no)} · ${esc(fp.title)}</span></div>
      <p class="note">Tarihi olmayan işler. “Bugüne al” deyince bugünkü bloğa saatiyle yerleşir.</p>
      ${next.length ? next.map(t => taskRow(t, {pull: true})).join('') : `<p class="empty">Bu aşamada ${shared() ? 'sana düşen ' : ''}tarihsiz açık iş kalmadı.</p>`}</section>`;
  }
  h += partnerCard(key);
  return h;
}

// Ortağın son 7 günde bitirdikleri ve şu anki aşamada ona düşen açık işler.
function partnerCard(key) {
  if (!shared() || !partners().length) return '';
  const since = iso(addDays(today(), -6)), fp = focusPhase();
  const done = S.tasks.filter(t => !t._mine && t.done && t.doneBy && t.doneBy !== S.me && String(t.doneAt || '') >= since && t.doneAt <= key)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, 5);
  const open = fp ? tasksOf(fp.id).filter(t => !t.done && forPartner(t) && normWho(t.who) !== 'ikimiz').length : 0;
  const names = partners().map(memberName).join(', ');
  return `<section class="card"><div class="card-head"><h2>Ortaktan</h2><span class="count">${esc(names)} · son 7 gün</span></div>
    ${done.length ? done.map(t => taskRow(t)).join('') : '<p class="empty">Son 7 günde bitirilen ortak iş yok.</p>'}
    ${fp && open ? `<p class="hint">${esc(fp.no)} aşamasında ${esc(names)} için ${open} açık iş var.</p>` : ''}</section>`;
}

function viewWeek() {
  if (S.tplEdit) return viewTemplate();
  const mon = addDays(monday(today()), S.weekOff * 7), sun = addDays(mon, 6), tkey = todayKey(), monKey = iso(mon);
  const keys = Array.from({length: 7}, (_, i) => iso(addDays(mon, i)));
  const fa = focusArea();
  let faPlan = 0, faDone = 0;
  keys.forEach(k => blocksFor(parse(k)).forEach(b => { if (fa && b.area === fa) { const mm = blockMin(b); faPlan += mm; if (isDone(k, b.id)) faDone += mm; } }));
  const en = weekEnergy(mon);
  const label = {0: 'Bu hafta', '-1': 'Geçen hafta', 1: 'Gelecek hafta'}[S.weekOff] || (S.weekOff < 0 ? `${-S.weekOff} hafta önce` : `${S.weekOff} hafta sonra`);
  let h = `<header class="head">${top(label)}<div class="weekbar"><button class="nav" type="button" data-act="weekPrev" aria-label="Önceki hafta">${SVG('<path d="m15 6-6 6 6 6"/>')}</button>
    <h1>${mon.getDate()} ${MON_S[mon.getMonth()]} – ${sun.getDate()} ${MON_S[sun.getMonth()]}</h1>
    <button class="nav" type="button" data-act="weekNext" aria-label="Sonraki hafta">${SVG('<path d="m9 6 6 6-6 6"/>')}</button></div></header>`;

  const counts = keys.map(k => dayCount(k)), wDone = counts.reduce((s, c) => s + c.done, 0), wTot = counts.reduce((s, c) => s + c.total, 0);
  h += `<section class="stats">
      <div class="stat"><span class="k">Tamamlanan</span><span class="v">${wDone} <small>/ ${wTot}</small></span></div>
      <div class="stat"><span class="k">Bu hafta puan</span><span class="v">+${nf.format(dayXP(keys))}</span></div>
      <div class="stat"><span class="k">${esc(fa ? areaLabel(fa) : 'Odak alanı')} saati</span><span class="v">${nf1.format(faDone / 60)} <small>/ ${nf1.format(faPlan / 60)}</small></span></div></section>`;

  // Bu haftanın hedefi: şu anki aşama, kapı şartları ve bana düşen işlerin durumu.
  const fp = S.weekOff === 0 ? focusPhase() : null;
  if (fp) {
    const ts = tasksOf(fp.id), mine = ts.filter(t => t.kind !== 'gate' && forMe(t)), gts = ts.filter(t => t.kind === 'gate');
    h += `<section class="card goal"><div class="card-head"><h2>Bu haftanın hedefi</h2><span class="count">${esc(fp.no)} · ${esc(fp.title)}</span></div>
      <p class="note">${fp.gateLabel ? `Kapı: ${esc(fp.gateLabel)}. ` : ''}Hafta bitmeden bunlar tamam olmalı:</p>
      ${gts.length ? gts.map(t => taskRow(t)).join('') : '<p class="empty">Bu aşamada kapı şartı yok.</p>'}
      <p class="hint">Sana düşen işler: ${mine.filter(t => t.done).length}/${mine.length} bitti. Tamamı Plan’da.</p></section>`;
  }

  // Her gün: alışkanlık tablosu. Hücreler günün tarihi; dolu = yapıldı. Geçmiş ve bugün işaretlenebilir.
  const hs = habits(), g = game();
  if (hs.length) {
    h += `<section class="card"><div class="card-head"><h2>Her gün</h2><span class="count">zincir</span></div>
      ${hs.map(b => {
        const s = g.streaks.get(b.id) || {cur: 0};
        return `<div class="hab"><div class="hab-top"><span class="hab-t"><b>${esc(b.title)}</b><small>${esc(b.start || 'Gün içi')}${b.core ? ' · her koşulda' : ''}</small></span>
          <span class="flame${s.cur ? '' : ' off'}">${FLAME}${s.cur}</span></div>
          <div class="hab-cells">${keys.map((k, i) => {
            const dd = dayDoc(k), done = isDone(k, b.id), fut = k > tkey, excused = !done && (dd.joker || (dd.bad && !b.core));
            const cls = done ? ' on' : fut ? ' fut' : excused ? ' exc' : k === tkey ? ' now' : ' miss';
            return `<button class="hc${cls}" type="button" data-act="toggleBlock" data-id="${esc(b.id)}" data-date="${k}" aria-pressed="${done}" aria-label="${esc(b.title)} · ${DOW_L[i + 1]}"${fut ? ' disabled' : ''}><small>${DOW_S[i + 1].slice(0, 2)}</small>${parse(k).getDate()}</button>`;
          }).join('')}</div></div>`;
      }).join('')}</section>`;
  }

  // Günler: her günün kendine özgü blokları ve işleri. Bugün açık gelir; diğerine dokununca açılır.
  const defOpen = keys.includes(tkey) ? tkey : keys[0];
  h += `<section class="card days"><div class="card-head"><h2>Günler</h2><span class="count">her gün listesi hariç</span></div>
    ${keys.map((k, i) => {
      const p = dayPlan(k, {noHabits: true}), c = counts[i], dd = p.dd, isOpen = S.openDays[k] ?? (k === defOpen), fut = k > tkey;
      const items = [...p.timed, ...p.untimed];
      const sum = items.length ? items.map(x => `${x.start ? x.start + ' ' : ''}${x.title}${x.kids.length ? ` (${x.kids.length} iş)` : ''}`).join(' · ') : 'Boş akşam: sadece her gün listesi';
      const prog = fut ? `<span class="count">${c.total} madde</span>` : `<span class="count${c.total && c.done === c.total ? ' ok' : ''}">${c.done}/${c.total}</span>`;
      return `<div class="day${k === tkey ? ' is-today' : ''}${isOpen ? ' is-open' : ''}">
        <button class="day-head" type="button" data-act="dayOpen" data-date="${k}" aria-expanded="${isOpen}">
          <span class="day-n"><b>${parse(k).getDate()}</b><small>${DOW_S[i + 1]}</small></span>
          <span class="day-t"><strong>${DOW_L[i + 1]}${k === tkey ? ' · bugün' : ''}${dd.bad ? ' · kötü gün' : ''}${dd.joker ? ' · joker' : ''}</strong><small>${esc(sum)}</small></span>
          <span class="day-r">${prog}${CHEV}</span></button>
        ${isOpen ? `<div class="day-body">${items.length ? `<div class="tl">${items.map(it => itemRow(it, k, fut)).join('')}</div>` : '<p class="empty">Bu gün için blok ya da iş yok.</p>'}
          <button class="add-inline" type="button" data-act="add" data-due="${k}">+ Bu güne iş ekle</button></div>` : ''}</div>`;
    }).join('')}</section>`;

  const rv = S.weeks[reviewId(monKey)];
  const rvBody = r => r && (r.good || r.stuck || r.next) ? `<dl>${r.good ? `<div><dt>İyi giden</dt><dd>${esc(r.good)}</dd></div>` : ''}${r.stuck ? `<div><dt>Takılan</dt><dd>${esc(r.stuck)}</dd></div>` : ''}${r.next ? `<div><dt>Gelecek haftanın önceliği</dt><dd>${esc(r.next)}</dd></div>` : ''}</dl>` : '';
  let rvHtml;
  if (shared()) {
    const parts = [S.me, ...partners()].map(k => {
      const body = rvBody(S.weeks[reviewId(monKey, k)]);
      return `<div class="rv-person"><p class="rv-who">${esc(k === S.me ? 'Sen' : memberName(k))}</p>${body || `<p class="note">${k === S.me ? 'Henüz yazmadın.' : 'Henüz yazmadı.'}</p>`}</div>`;
    });
    rvHtml = parts.join('');
  } else rvHtml = rvBody(rv) || '<p class="note">Pazar, 15 dk: ne iyi gitti, nerede takıldın, gelecek haftanın 3 önceliği.</p>';
  h += `<section class="card review"><div class="card-head"><h2>Haftalık değerlendirme</h2><button class="link" type="button" data-act="review" data-week="${monKey}">${rv ? 'Düzenle' : 'Yaz'}</button></div>
    <p class="note">Enerji ortalaması ${en ? nf1.format(en.avg) : '–'} / 5 · yazınca +${XP.review} puan</p>
    ${rvHtml}</section>`;
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
        ${b.note ? `<span class="row-desc">${esc(brief(b.note))}</span>` : ''}<span class="row-meta"><b>${esc(b.start ? (b.end ? `${b.start}–${b.end}` : b.start) : 'Gün içi')}</b><span class="sep">·</span>${dot(b.area)}${esc(areaLabel(b.area))}${b.core ? '<span class="sep">·</span>her koşulda' : ''}</span></button></div>`).join('')}
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
    ${gates.length ? `<div class="stops" style="grid-template-columns:repeat(${Math.min(gates.length, 4)}, minmax(0,1fr))">${gates.map(p => `<div class="stop">${stamp(phaseDone(p))}<strong>${esc(p.gateShort || p.gateLabel || '')}</strong></div>`).join('')}</div>` : ''}</section>`;

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
    ${tgt ? `<div class="metric" style="padding-top:4px"><div class="m-top"><span class="k">Birikim</span><span class="v">${money(sav)} <small>/ ${money(tgt)}</small></span></div>
      <div class="bar"><i style="width:${Math.max(0, Math.min(100, sav / tgt * 100)).toFixed(1)}%"></i><b style="left:25%"></b><b style="left:50%"></b><b style="left:75%"></b></div>
      <div class="ticks"><span style="left:25%">%25</span><span style="left:50%">%50</span><span style="left:75%">%75</span></div></div>` : ''}
    <div class="metric pair"${tgt ? '' : ' style="padding-top:4px"'}><div><span class="k">Ödeme yapan müşteri</span><span class="v">${nf.format(cli)} <small>/ ${nf.format(cliT)}</small></span></div>
      <div><span class="k">Eşik üstü ay, üst üste</span><span class="v">${streak} <small>/ 3</small></span></div></div>
    <div class="metric"><span class="k">${esc(incLabel())}${it ? ` · eşik ${money(it)}/ay` : ''}</span>
      <div class="months">${months.map(x => { const v = inc[monthKey(x)]; return `<div class="mo${meets(v) ? ' ok' : ''}"><span class="k">${MON_S[x.getMonth()]} ${x.getFullYear()}</span><span class="v">${v != null && v !== '' ? money(v) : '–'}</span></div>`; }).join('')}</div></div>
  </section>`;
  h += goldCard(months);

  ps.forEach(p => {
    const ts = tasksOf(p.id), tasks = ts.filter(t => t.kind !== 'gate'), gts = ts.filter(t => t.kind === 'gate');
    const open = S.open[p.id] ?? (fp && p.id === fp.id), complete = phaseDone(p), dn = tasks.filter(t => t.done).length;
    const no = String(p.no ?? ''), digits = no.replace(/\D/g, ''), hasMonth = p.start != null && p.start !== '';
    h += `<section class="phase${complete ? ' is-complete' : ''}"><button class="phase-head" type="button" data-act="phase" data-id="${esc(p.id)}" aria-expanded="${!!open}">
      <span class="ph-no${digits ? '' : ' txt'}">${esc(digits || no.slice(0, 3))}</span>
      <span class="ph-t"><strong>${esc(p.title)}</strong><small>${esc(p.label || '')}${hasMonth ? `${p.label ? ' · ' : ''}Ay ${esc(p.start === p.end || p.end == null || p.end === '' ? p.start : `${p.start}–${p.end}`)}` : ''}</small>
        <span class="ph-prog"><i style="width:${tasks.length ? dn / tasks.length * 100 : 0}%"></i></span></span>
      <span class="ph-r">${dn}/${tasks.length}${CHEV}</span></button>
      ${open ? `<div class="phase-body">${tasks.map(t => taskRow(t, {note: true})).join('')}
        <button class="add-inline" type="button" data-act="add" data-phase="${esc(p.id)}">+ İş ekle</button>
        ${gts.length ? `<div class="gate"><div class="gate-head">${stamp(complete, true)}<div><p class="eyebrow">Kapı</p><strong>${esc(p.gateLabel || '')}</strong></div></div>${gts.map(t => taskRow(t)).join('')}</div>` : ''}
        <div class="phase-tools"><button class="link" type="button" data-act="editPhase" data-id="${esc(p.id)}">Aşamayı düzenle</button></div>
      </div>` : ''}</section>`;
  });
  h += `<div class="plan-tools"><button class="ghost" type="button" data-act="addPhase">${SVG('<path d="M12 5v14M5 12h14"/>')}Aşama ekle</button>
    <button class="ghost" type="button" data-act="planSettings">${SVG('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>')}Planı düzenle</button></div>`;
  return h;
}

/* ---------- altın birikimi: kişisel ayarlarda (prefs/app.gold), ortağa görünmez ----------
   gold = {target: hedef gram (ilk kira mülkü kaç gram ediyor), m: {'YYYY-AA': o ay net alınan gram}} */
const nf2 = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2});
const gram = v => `${nf2.format(Number(v) || 0)} gr`;
const goldP = () => { const g = (S.prefs || {}).gold; return g && typeof g === 'object' ? g : {}; };
const goldMonths = () => { const m = goldP().m; return m && typeof m === 'object' ? m : {}; };
const goldTotal = () => Object.values(goldMonths()).reduce((s, v) => s + (Number(v) || 0), 0);
function goldCard(months) {
  const m = goldMonths(), tot = goldTotal(), tgt = Number(goldP().target) || 0, pct = tgt ? Math.max(0, Math.min(100, tot / tgt * 100)) : 0;
  return `<section class="card"><div class="card-head"><h2>Altın birikimi</h2><button class="link" type="button" data-act="gold">Güncelle</button></div>
    <div class="metric" style="padding-top:4px"><div class="m-top"><span class="k">Toplam</span><span class="v">${gram(tot)}${tgt ? ` <small>/ ${gram(tgt)}</small>` : ''}</span></div>
      ${tgt ? `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i><b style="left:25%"></b><b style="left:50%"></b><b style="left:75%"></b></div>
      <div class="ticks"><span style="left:25%">%25</span><span style="left:50%">%50</span><span style="left:75%">%75</span></div>` : ''}</div>
    <div class="metric"><span class="k">Ay ay alınan</span>
      <div class="months">${months.map(x => { const v = m[monthKey(x)]; return `<div class="mo${Number(v) > 0 ? ' ok' : ''}"><span class="k">${MON_S[x.getMonth()]} ${x.getFullYear()}</span><span class="v">${v != null && v !== '' ? gram(v) : '–'}</span></div>`; }).join('')}</div></div>
    <p class="note">Sadece sen görürsün.${tgt ? '' : ' Hedef olarak ilk kira mülkünün kaç gram altın ettiğini yaz.'}</p></section>`;
}

function viewList() {
  const f = shared() ? S.listFilter : 'all';
  const pick = t => f === 'me' ? forMe(t) : f === 'partner' ? forPartner(t) : true;
  const k = todayKey(), open = S.tasks.filter(t => !t.done && pick(t));
  const late = open.filter(t => t.due && t.due < k).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const now = open.filter(t => t.due === k).sort(byOrder);
  const soon = open.filter(t => t.due && t.due > k).sort((a, b) => String(a.due).localeCompare(String(b.due)) || byOrder(a, b));
  const inbox = open.filter(t => !t.due && !t.phase).sort(byOrder);
  const allDone = S.tasks.filter(t => t.done && pick(t));
  const done = allDone.sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''))).slice(0, 12);
  const sec = (title, list, empty) => `<section class="card"><div class="card-head"><h2>${title}</h2><span class="count">${list.length}</span></div>
    ${list.length ? list.map(t => taskRow(t, {note: true})).join('') : `<p class="empty">${empty}</p>`}</section>`;
  let h = `<header class="head">${top(`${open.length} açık iş`)}<div class="hero"><div><h1>Liste</h1><p class="sub">Aşama işleri Plan’da. Burada tarihli işler, gelen kutusu ve fikirler.</p></div></div></header>`;
  if (shared() && partners().length) {
    const opts = [['all', 'Hepsi'], ['me', 'Benim'], ['partner', partners().map(memberName).join(', ')]];
    h += `<div class="segc three list-filter" role="group" aria-label="Kimin işleri">${opts.map(([v, l]) => `<button type="button" data-act="listFilter" data-v="${v}" aria-pressed="${f === v}">${esc(l)}</button>`).join('')}</div>`;
  }
  if (late.length) h += sec('Gecikenler', late, '');
  h += sec('Bugün', now, 'Bugüne tarihli iş yok.');
  h += sec('Yaklaşanlar', soon, 'Tarihli iş yok.');
  h += sec('Gelen kutusu', inbox, 'Boş. + ile hızlıca iş ekle, aşamasını sonra seç.');
  const ideas = [...S.ideas].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  h += `<section class="card"><div class="card-head"><h2>Fikir defteri</h2><button class="link" type="button" data-act="addIdea">Fikir ekle</button></div>
    <p class="note">Proje limiti: 1 para + 1 tutku. Yeni fikir plana girmez, burada bekler.${shared() ? ' Fikir defteri ortak.' : ''}</p>
    ${ideas.length ? ideas.map(i => `<div class="row"><div class="row-main"><span class="row-title">${esc(i.text)}</span><span class="row-meta">${shared() && i.by && i.by !== S.me ? `${esc(memberName(i.by))}<span class="sep">·</span>` : ''}${i.createdAt ? esc(shortDate(String(i.createdAt).slice(0, 10))) : ''}</span></div>
      <button class="mini" type="button" data-act="delIdea" data-id="${esc(i.id)}">Sil</button></div>`).join('') : '<p class="empty">Henüz fikir yok.</p>'}</section>`;
  if (done.length) h += `<section class="card"><div class="card-head"><h2>Son bitenler</h2><span class="count">${allDone.length} toplam</span></div>${done.map(t => taskRow(t)).join('')}</section>`;
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
  S.akeys = null; S.gx = null;
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
// Aynı belgeye art arda yazmalar sıraya girer: yeni bir gün belgesine iki hızlı dokunuş birbirini ezmesin.
const upq = new Map();
function upsert(path, patch, base) {
  const p = (upq.get(path) || Promise.resolve()).then(() => write(path, async () => {
    const ref = db.doc(path), snap = await ref.get();
    if (snap.exists) await ref.update(patch); else await ref.set({...base, ...patch});
  }));
  upq.set(path, p);
  p.then(() => { if (upq.get(path) === p) upq.delete(path); });
  return p;
}
// Kişisel ayarlara yazma: ekranda hemen görünsün diye yerel kopya da güncellenir.
function setPrefs(patch) {
  S.prefs = {...(S.prefs || {}), ...patch}; S.cfgC = null; S.akeys = null; S.gx = null;
  return upsert('prefs/app', patch, {});
}
// Ekranda hemen göster; depo anlık görüntüsü aynı mikro görevde yerine geçer.
function localDay(k, patch) {
  const cur = dayDoc(k);
  S.days = {...S.days, [k]: {...cur, date: k, ...patch, done: {...(cur.done || {}), ...(patch.done || {})}}};
  render();
}
function localTask(id, patch) { S.tasks = S.tasks.map(t => t.id === id ? {...t, ...patch} : t); render(); }
// Ekrana özel alanlar (_col, _mine) belgeye yazılmaz.
const plain = t => { const {id: _i, _col: _c, _mine: _m, ...rest} = t; return rest; };
function listen() {
  const fail = name => e => { console.warn('Rota: dinleyici durdu', name, e); toast('Veri okunamadı. Uygulamayı yeniden aç.'); };
  const col = (name, key, after) => db.collection(name).onSnapshot(s => {
    S[key] = s.docs.map(x => ({id: x.id, ...x.data()})); S.got[key] = true; if (after) after(); S.akeys = null; render();
  }, fail(name));
  // Ortak işler (tasks) ve özel işler (mytasks) ekranda tek listedir; her iş hangi koleksiyondan geldiğini taşır.
  const mergeTasks = () => {
    S.tasks = [...S.shTasks.map(t => ({...t, _col: 'tasks'})), ...S.myTasks.map(t => ({...t, _col: 'mytasks', _mine: true}))];
    S.got.tasks = !!(S.got.shTasks && S.got.myTasks);
  };
  col('tasks', 'shTasks', mergeTasks); col('mytasks', 'myTasks', mergeTasks);
  col('routine', 'routine'); col('phases', 'phases'); col('ideas', 'ideas');
  db.collection('weeks').onSnapshot(s => { const o = {}; s.docs.forEach(x => { o[x.id] = x.data(); }); S.weeks = o; render(); }, fail('weeks'));
  // Zincir ve puan geçmişe bakar: yaklaşık iki yıllık gün belgesi.
  db.collection('days').orderBy('date', 'desc').limit(800).onSnapshot(s => { const o = {}; s.docs.forEach(x => { o[x.id] = x.data(); }); S.days = o; render(); }, fail('days'));
  db.doc('metrics/main').onSnapshot(s => { S.metrics = s.exists ? s.data() : null; render(); }, fail('metrics'));
  db.doc('settings/app').onSnapshot(s => { S.settings = s.exists ? s.data() : null; S.akeys = null; S.cfgC = null; render(); }, fail('settings'));
  db.doc('prefs/app').onSnapshot(s => { S.prefs = s.exists ? s.data() : null; S.akeys = null; S.cfgC = null; render(); }, fail('prefs'));
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
  t = t || {title: '', note: '', due: p.due || '', phase: p.phase || '', area: defaultArea(), who: shared() ? S.me : 'ben', kind: 'task'};
  const priv = shared() && !!t._mine, who = normWho(t.who);
  const vis = shared() ? `<div class="fld"><span>Kimler görür</span><div class="seg two">
      <label><input type="radio" name="vis" value="ortak"${priv ? '' : ' checked'}><span>Ortak plan</span></label>
      <label><input type="radio" name="vis" value="ben"${priv ? ' checked' : ''}><span>Sadece ben</span></label></div></div>` : '';
  const opts = whoOptions();
  return `<form id="f-task" class="${priv ? 'is-private' : ''}" data-id="${isNew ? '' : esc(t.id)}" autocomplete="off">${head(isNew ? 'Yeni iş' : 'İşi düzenle')}${isNew ? modeSwitch('task') : ''}
    <label class="fld"><span>Ne yapılacak?</span><input class="big" id="f-title" name="title" required maxlength="200" value="${esc(t.title)}" placeholder="Örn. Teklif metnini bitir"></label>
    ${vis}
    <div class="fld"><span>Tarih</span><div class="chips">${dateChips(t.due)}</div><input type="date" id="f-due" name="due" value="${esc(t.due || '')}" aria-label="Tarih seç"></div>
    <div class="grid2"><label class="fld"><span>Saat</span><input type="time" id="f-time" name="time" value="${esc(t.time || '')}"></label>
      <label class="fld"><span>Süre, dk</span><input type="number" id="f-min" name="min" min="5" max="600" step="5" inputmode="numeric" value="${esc(t.min || '')}" placeholder="30"></label></div>
    <p class="note fld-note">Tarih verip saati boş bırakırsan o günün bloğunda ilk boş saate yerleşir.</p>
    <div class="grid2"><label class="fld shared-only"><span>Aşama</span><select id="f-phase" name="phase"><option value="">Gelen kutusu</option>${phases().map(x => `<option value="${esc(x.id)}"${x.id === t.phase ? ' selected' : ''}>${esc(x.no)}: ${esc(x.title)}</option>`).join('')}</select></label>
      <label class="fld"><span>Alan</span><select id="f-area" name="area">${areaOpts(t.area)}</select></label></div>
    <div class="fld shared-only"><span>Kim</span><div class="seg${opts.length === 2 ? ' two' : ''}">${opts.map(([v, l]) => `<label><input type="radio" name="who" value="${esc(v)}"${who === v ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></div>
    <label class="check shared-only"><input type="checkbox" id="f-gate" name="gate"${t.kind === 'gate' ? ' checked' : ''}> Kapı şartı (aşamanın geçiş koşulu)</label>
    <label class="fld"><span>Açıklama</span><textarea id="f-note" name="note" rows="5" maxlength="2000" placeholder="Ne: …&#10;Nasıl: …&#10;Bitti sayılır: …&#10;(madde için satır başına - koy)">${esc(t.note || '')}</textarea></label>
    ${!isNew && shared() && t.createdBy && t.createdBy !== S.me ? `<p class="note">${esc(memberName(t.createdBy))} ekledi.</p>` : ''}
    <div class="actions">${isNew ? '' : `<button type="button" class="danger" data-act="delTask" data-id="${esc(t.id)}">Sil</button>`}<button type="submit" class="primary">Kaydet</button></div></form>`;
}
const ideaForm = () => `<form id="f-idea" autocomplete="off">${head('Yeni fikir')}${modeSwitch('idea')}
  <p class="note">Proje limiti: 1 para + 1 tutku. Fikir burada bekler, plana girmez.${shared() ? ' Ortağın da görür.' : ''}</p>
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
    <label class="fld"><span>Açıklama: bu blokta ne yapılır?</span><textarea id="b-note" name="note" rows="3" maxlength="1000">${esc(b.note || '')}</textarea></label>
    <label class="check"><input type="checkbox" id="b-core" name="core"${b.core ? ' checked' : ''}> Kötü günde de yapılır</label>
    <div class="actions">${isNew ? '' : `<button type="button" class="danger" data-act="delBlock" data-id="${esc(b.id)}">Sil</button>`}<button type="submit" class="primary">Kaydet</button></div></form>`;
}
function reviewForm(monKey) {
  const r = S.weeks[reviewId(monKey)] || {}, mon = parse(monKey), sun = addDays(mon, 6), en = weekEnergy(mon);
  return `<form id="f-review" data-week="${esc(monKey)}">${head('Haftalık değerlendirme')}
    <p class="note">${mon.getDate()} ${MON_S[mon.getMonth()]} – ${sun.getDate()} ${MON_S[sun.getMonth()]} · enerji ortalaması ${en ? nf1.format(en.avg) : '–'} / 5${shared() ? ' · ortağın da görür' : ''}</p>
    <label class="fld"><span>Ne iyi gitti?</span><textarea id="r-good" name="good" rows="2" maxlength="2000">${esc(r.good || '')}</textarea></label>
    <label class="fld"><span>Nerede takıldım?</span><textarea id="r-stuck" name="stuck" rows="2" maxlength="2000">${esc(r.stuck || '')}</textarea></label>
    <label class="fld"><span>Gelecek haftanın 3 önceliği</span><textarea id="r-next" name="next" rows="3" maxlength="2000">${esc(r.next || '')}</textarea></label>
    <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
}
function metricsForm() {
  const mt = S.metrics || {}, d = today(), inc = mt.income || {}, it = Number(mt.incomeTarget) || 0;
  const ms = Array.from({length: 6}, (_, k) => new Date(d.getFullYear(), d.getMonth() - k, 1));
  const cur = currency();
  return `<form id="f-metrics">${head('Göstergeleri güncelle')}
    ${Number(mt.savingsTarget) ? `<label class="fld"><span>Birikim, toplam (${cur})</span><input type="number" id="m-sav" name="sav" min="0" step="1" inputmode="decimal" value="${esc(mt.savingsEur ?? 0)}"></label>` : ''}
    <label class="fld"><span>Ödeme yapan müşteri sayısı</span><input type="number" id="m-cli" name="cli" min="0" step="1" inputmode="numeric" value="${esc(mt.clients ?? 0)}"></label>
    <div class="grid2"><label class="fld"><span>Ay</span><select id="m-month" name="month">${ms.map(x => `<option value="${monthKey(x)}">${MON_L[x.getMonth()]} ${x.getFullYear()}</option>`).join('')}</select></label>
      <label class="fld"><span>${esc(incLabel())} (${cur})</span><input type="number" id="m-inc" name="inc" min="0" step="1" inputmode="decimal" placeholder="Girilmedi" value="${esc(inc[monthKey(d)] ?? '')}"></label></div>
    <p class="note">O ayın toplam net geliri.${it ? ` Eşik ${money(it)}/ay.` : ''}${shared() ? ' Göstergeler ortak.' : ''}</p>
    <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
}
function goldForm() {
  const m = goldMonths(), d = today(), tgt = goldP().target;
  const ms = Array.from({length: 6}, (_, k) => new Date(d.getFullYear(), d.getMonth() - k, 1));
  // Gram alanında inputmode yok: Android klavyesinde eksi işareti (satış) çıksın.
  return `<form id="f-gold">${head('Altın birikimi')}
    <div class="grid2"><label class="fld"><span>Ay</span><select id="g-month" name="month">${ms.map(x => `<option value="${monthKey(x)}">${MON_L[x.getMonth()]} ${x.getFullYear()}</option>`).join('')}</select></label>
      <label class="fld"><span>O ay alınan, gram</span><input type="number" id="g-gr" name="gr" step="0.01" placeholder="Girilmedi" value="${esc(m[monthKey(d)] ?? '')}"></label></div>
    <p class="note">O ayın toplamı. Sattıysan eksi yaz; boş bırakırsan o ay silinir.</p>
    <label class="fld"><span>Hedef, gram: ilk kira mülkü kaç gram ediyor?</span><input type="number" id="g-tgt" name="tgt" min="0" step="1" inputmode="numeric" placeholder="Boş" value="${esc(tgt ?? '')}"></label>
    <p class="note">Hedefi yılda bir güncelle. Bu kart sadece sende; ortağın görmez.</p>
    <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
}
function phaseForm(p) {
  const isNew = !p;
  p = p || {no: `Aşama ${S.phases.length + 1}`, title: '', label: '', start: '', end: '', gateLabel: '', gateMonth: ''};
  const n = planMonths(), num = v => (v == null ? '' : esc(v));
  return `<form id="f-phase" data-id="${isNew ? '' : esc(p.id)}" autocomplete="off">${head(isNew ? 'Yeni aşama' : 'Aşamayı düzenle')}
    <div class="grid2"><label class="fld"><span>Kısa ad</span><input id="ph-no" name="no" required maxlength="20" value="${esc(p.no || '')}" placeholder="Hafta 5"></label>
      <label class="fld"><span>Tarih aralığı</span><input id="ph-label" name="label" maxlength="40" value="${esc(p.label || '')}" placeholder="1–7 Aralık"></label></div>
    <label class="fld"><span>Başlık</span><input class="big" id="ph-title" name="title" required maxlength="80" value="${esc(p.title || '')}" placeholder="Örn. İlk teklifler"></label>
    <div class="grid2"><label class="fld"><span>Başladığı ay (1–${n})</span><input type="number" id="ph-start" name="start" min="1" max="${n}" step="1" inputmode="numeric" value="${num(p.start)}" placeholder="Boş"></label>
      <label class="fld"><span>Bittiği ay</span><input type="number" id="ph-end" name="end" min="1" max="${n}" step="1" inputmode="numeric" value="${num(p.end)}" placeholder="Boş"></label></div>
    <label class="fld"><span>Kapı (aşamanın geçiş koşulu)</span><input id="ph-gate" name="gateLabel" maxlength="60" value="${esc(p.gateLabel || '')}" placeholder="Örn. İlk ücretli iş"></label>
    <label class="fld"><span>Kapının rota çizgisindeki ayı</span><input type="number" id="ph-gm" name="gateMonth" min="1" max="${n}" step="1" inputmode="numeric" value="${num(p.gateMonth)}" placeholder="Boş: çizgide görünmez"></label>
    <p class="note">Kapı şartlarını aşamanın içine "Kapı şartı" işaretli iş olarak ekle.</p>
    <div class="actions">${isNew ? '' : `<button type="button" class="danger" data-act="delPhase" data-id="${esc(p.id)}">Sil</button>`}<button type="submit" class="primary">Kaydet</button></div></form>`;
}
function planForm() {
  const c = S.settings || {}, mt = S.metrics || {}, cur = currency();
  return `<form id="f-plan" autocomplete="off">${head('Planı düzenle')}
    <label class="fld"><span>Plan adı</span><input class="big" id="pl-title" name="title" required maxlength="60" value="${esc(c.planTitle || 'Plan')}"></label>
    <label class="fld"><span>Kısa açıklama</span><textarea id="pl-sub" name="sub" rows="2" maxlength="200">${esc(c.planSub || '')}</textarea></label>
    <div class="grid2"><label class="fld"><span>Başlangıç</span><input type="date" id="pl-start" name="start" value="${esc(iso(planStart()))}"></label>
      <label class="fld"><span>Süre, ay</span><input type="number" id="pl-months" name="months" min="1" max="120" step="1" inputmode="numeric" value="${planMonths()}"></label></div>
    <div class="grid2"><label class="fld"><span>Aylık gelir eşiği (${cur})</span><input type="number" id="pl-inc" name="inc" min="0" step="1" inputmode="decimal" placeholder="Boş" value="${esc(mt.incomeTarget ?? '')}"></label>
      <label class="fld"><span>Müşteri hedefi</span><input type="number" id="pl-cli" name="cli" min="1" step="1" inputmode="numeric" value="${esc(mt.clientsTarget ?? 3)}"></label></div>
    <div class="fld"><span>Para birimi</span><div class="seg">${CURRENCIES.map(x => `<label><input type="radio" name="cur" value="${x}"${x === cur ? ' checked' : ''}><span>${x}</span></label>`).join('')}</div></div>
    ${shared() ? '<p class="note">Plan ortak: değişikliği ortağın da görür.</p>' : ''}
    <div class="actions"><button type="submit" class="primary">Kaydet</button></div></form>`;
}

/* ---------- ayrıntı: bir iş ya da blok, tam açıklamasıyla ---------- */
function detailSheet(k, id, key) {
  const dl = (a, b) => b ? `<div><dt>${a}</dt><dd>${b}</dd></div>` : '';
  if (k === 't') {
    const t = S.tasks.find(x => x.id === id);
    if (!t) return '';
    const ph = t.phase && S.phases.find(p => p.id === t.phase);
    const when = [t.due ? dueLabel(t.due)[0] : 'Tarihsiz', t.time ? `${t.time}–${addMin(t.time, taskMin(t))}` : '', t.min || t.time ? fmtDur(taskMin(t)) : ''].filter(Boolean).join(' · ');
    const canPull = !t.done && t.due !== todayKey();
    return `${head(t.kind === 'gate' ? 'Kapı şartı' : 'İş')}
      <p class="dt-when">${esc(when)}</p><h3 class="dt-title">${esc(t.title)}</h3>
      <div class="desc">${richText(t.note) || '<p class="muted">Açıklama yok. Düzenle’den ekleyebilirsin.</p>'}</div>
      <dl class="dt-meta">${dl('Alan', esc(t.area ? areaLabel(t.area) : 'Kişisel'))}${shared() ? dl('Kim', esc(t._mine ? 'Sadece ben' : whoLabel(t.who))) : ''}
        ${dl('Aşama', ph ? esc(`${ph.no}: ${ph.title}`) : '')}${dl('Puan', `+${t.kind === 'gate' ? XP.gate : XP.task}`)}
        ${shared() && t.createdBy && t.createdBy !== S.me ? dl('Ekleyen', esc(memberName(t.createdBy))) : ''}${t.done && t.doneBy ? dl('Bitiren', esc(memberName(t.doneBy))) : ''}</dl>
      <div class="actions"><button type="button" class="btn-sec" data-act="editTask" data-id="${esc(t.id)}">Düzenle</button>
        ${canPull ? `<button type="button" class="btn-sec" data-act="pullToday" data-id="${esc(t.id)}" data-close="1">Bugüne al</button>` : ''}
        <button type="button" class="primary" data-act="toggleTask" data-id="${esc(t.id)}" data-close="1">${t.done ? 'Geri al' : 'Bitti'}</button></div>`;
  }
  const b = S.routine.find(x => x.id === id);
  if (!b) return '';
  key = key || todayKey();
  const done = isDone(key, b.id), mm = blockMin(b), dd = dayDoc(key), dim = dd.joker || (dd.bad && !b.core);
  const when = [b.dow === 0 ? 'Her gün' : DOW_L[b.dow], b.start ? `${b.start}${b.end ? `–${b.end}` : ''}` : 'Gün içi', mm ? fmtDur(mm) : ''].filter(Boolean).join(' · ');
  const kids = dayPlan(key).blocks.find(x => x.id === b.id);
  const s = b.dow === 0 ? game().streaks.get(b.id) : null;
  const tot = s && b.unit && b.qty ? ` · toplam ${nf.format(s.total * Number(b.qty))} ${esc(b.unit)}` : s ? ` · toplam ${s.total} gün` : '';
  return `${head(b.dow === 0 ? 'Her gün' : 'Program bloğu')}
    <p class="dt-when">${esc(when)}</p><h3 class="dt-title">${esc(b.title)}</h3>
    <div class="desc">${richText(b.note) || '<p class="muted">Açıklama yok. Şablondan ekleyebilirsin.</p>'}</div>
    ${kids && kids.kids.length ? `<p class="sub-h">Bu bloktaki işler</p>${kids.kids.map(c => taskRow(c.t, {note: false})).join('')}` : ''}
    <dl class="dt-meta">${dl('Alan', esc(areaLabel(b.area)))}${s ? dl('Zincir', `${s.cur} gün · en iyi ${s.best}${tot}`) : ''}
      ${dl('Kötü günde', b.core ? 'Yine yapılır' : 'Sayılmaz, zinciri kırmaz')}${dl('Puan', `+${XP.block}`)}</dl>
    <div class="actions"><button type="button" class="btn-sec" data-act="editBlock" data-id="${esc(b.id)}">Şablonda düzenle</button>
      ${key > todayKey() || dim ? '' : `<button type="button" class="primary" data-act="toggleBlock" data-id="${esc(b.id)}" data-date="${key}" data-close="1">${done ? 'Geri al' : 'Bitti'}</button>`}</div>`;
}

/* ---------- puan ve ödüller ---------- */
function badgeList(g) {
  const best = Math.max(0, ...[...g.streaks.values()].map(s => s.best));
  const pages = habits().filter(h => h.unit === 'sayfa').reduce((s, h) => s + ((g.streaks.get(h.id) || {}).total || 0) * (Number(h.qty) || 0), 0);
  return [
    ['İlk adım', 'İlk maddeyi bitir', g.blocks + g.tasks + g.gates >= 1],
    ['İlk tam gün', 'Bir günün her maddesi', g.full >= 1],
    ['3 gün', '3 günlük zincir', best >= 3],
    ['7 gün', '7 günlük zincir', best >= 7],
    ['30 gün', '30 günlük zincir', best >= 30],
    ['100 gün', '100 günlük zincir', best >= 100],
    ['10 tam gün', '10 kez tam gün', g.full >= 10],
    ['İlk kapı', 'Bir kapı şartını bitir', g.gates >= 1],
    ['25 iş', '25 iş bitir', g.tasks >= 25],
    ['4 hafta', '4 haftalık değerlendirme', g.reviews >= 4],
    ['100 sayfa', 'Toplam 100 sayfa', pages >= 100],
    ['1000 sayfa', 'Toplam 1000 sayfa', pages >= 1000],
    ['Çırak', 'Seviye 5', g.level >= 5],
    ['Kalfa', 'Seviye 10', g.level >= 10],
  ];
}
function rewardsSheet() {
  const g = game(), list = rewards(), last = spentList().slice(-5).reverse(), bs = badgeList(g), p = g.need ? g.into / g.need * 100 : 0;
  const jokerToday = !!dayDoc(todayKey()).joker;
  return `${head('Puan ve ödüller')}
    <div class="lvl-card"><span class="lvl-no big" aria-hidden="true">${g.level}</span><div class="lvl-t"><strong>Seviye ${g.level} · ${esc(g.rank)}</strong>
      <span class="lvl-bar"><i style="width:${p.toFixed(1)}%"></i></span><small>Sonraki seviyeye ${nf.format(g.need - g.into)} puan · toplam ${nf.format(g.xp)}</small></div></div>
    <div class="wallet"><span>Cüzdan</span><b>${nf.format(Math.max(0, g.balance))} puan</b><small>Ödül alınca cüzdan azalır, seviye düşmez.</small></div>
    <h3 class="sh">Ödüller</h3>
    ${list.map(r => {
      const can = g.balance >= r.cost && !(r.joker && jokerToday);
      return `<div class="row"><div class="row-main"><span class="row-title">${esc(r.title)}</span><span class="row-meta">${nf.format(r.cost)} puan${r.joker && jokerToday ? '<span class="sep">·</span>bugün kullanıldı' : ''}</span></div>
        <button class="mini" type="button" data-act="buyReward" data-id="${esc(r.id)}"${can ? '' : ' disabled'}>Al</button>
        <button class="x-btn" type="button" data-act="delReward" data-id="${esc(r.id)}" aria-label="${esc(r.title)} ödülünü sil">${X_ICON}</button></div>`;
    }).join('')}
    <form id="f-reward" class="inline-form" autocomplete="off"><input name="title" required maxlength="80" placeholder="Yeni ödül" aria-label="Ödül adı">
      <input name="cost" type="number" required min="10" max="100000" step="10" inputmode="numeric" placeholder="Puan" aria-label="Puan"><button class="mini" type="submit">Ekle</button></form>
    ${last.length ? `<h3 class="sh">Son alınanlar</h3>${last.map(x => `<div class="row"><div class="row-main"><span class="row-title">${esc(x.title)}</span>
      <span class="row-meta">−${nf.format(x.cost)} puan<span class="sep">·</span>${esc(shortDate(String(x.at || '').slice(0, 10)))}</span></div></div>`).join('')}` : ''}
    <h3 class="sh">Rozetler · ${bs.filter(b => b[2]).length}/${bs.length}</h3>
    <div class="badges">${bs.map(([t, d, ok]) => `<div class="badge${ok ? ' ok' : ''}"><b>${esc(t)}</b><small>${esc(d)}</small></div>`).join('')}</div>
    <h3 class="sh">Puan nasıl kazanılır</h3>
    <ul class="rules"><li>Program bloğu ya da her gün maddesi: <b>+${XP.block}</b></li><li>İş: <b>+${XP.task}</b> · kapı şartı: <b>+${XP.gate}</b></li>
      <li>Tam gün (günün her maddesi bitti): <b>+${XP.full}</b></li><li>Haftalık değerlendirme: <b>+${XP.review}</b></li>
      <li>Zincir bonusu: ${MILES.map(([n, x]) => `${n} gün +${x}`).join(' · ')}</li>
      <li>Kötü günde yalnız “her koşulda” maddeler sayılır; diğerlerinin zinciri kırılmaz. Joker gün hiçbir zinciri kırmaz.</li>
      <li>Seviye ${RANKS.slice().reverse().map(([n, r]) => `${n}+ ${r}`).join(' · ')}</li></ul>`;
}

/* ---------- hatırlatmalar (Web Push) ----------
   Abonelik kişisel "push" koleksiyonunda durur. Sunucu (rota-remind) her dakika saati gelen maddeleri gönderir. */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const notifyPrefs = () => ((S.prefs || {}).notify) || {};
const pushOn = () => pushSupported() && !!S.push.sub && Notification.permission === 'granted' && notifyPrefs().on !== false;
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ub64 = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function subId(endpoint) { return 'p' + b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 24); }
async function swReg() { const r = await navigator.serviceWorker.getRegistration(); return r || navigator.serviceWorker.ready; }
async function saveSub(sub) {
  const j = sub.toJSON(), id = await subId(j.endpoint), ref = db.doc('push/' + id), cur = await ref.get();
  if (cur.exists && cur.data().endpoint === j.endpoint) return;
  await ref.set({endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent.slice(0, 160), at: new Date().toISOString()});
}
// Açılışta: tarayıcıdaki abonelik buluttakiyle aynı mı? Değiştiyse (tarayıcı yenilediyse) yeniden kaydet.
async function pushInit() {
  if (!pushSupported()) { S.push.checked = true; return; }
  try {
    const reg = await swReg(), sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    S.push = {sub: sub ? sub.endpoint : null, checked: true};
    if (sub && Notification.permission === 'granted' && notifyPrefs().on !== false) await saveSub(sub);
  } catch (e) { S.push.checked = true; console.warn('Rota: bildirim durumu okunamadı', e); }
  render(); refreshNotify();
}
async function notifyOn(btn) {
  if (!pushSupported()) { toast('Bu tarayıcı bildirim desteklemiyor.'); return; }
  if (!navigator.onLine) { toast('Açmak için internet gerekli.'); return; }
  busy(btn, true);
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast(perm === 'denied' ? 'Bildirim izni kapalı. Chrome > Site ayarları > Bildirimler.' : 'Bildirim izni verilmedi.', {ms: 4500}); return; }
    const reg = await swReg();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const r = await fetch(FN_URL + '?vapid=1', {cache: 'no-store'});
      if (!r.ok) throw new Error('sunucu ' + r.status);
      const {publicKey} = await r.json();
      sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: ub64(publicKey)});
    }
    await saveSub(sub);
    await setPrefs({notify: {on: true, lead: Number(notifyPrefs().lead) || 0}});
    S.push.sub = sub.endpoint;
    toast('Hatırlatmalar açık. Deneme bildirimi geliyor.');
    notifyTest(true);
  } catch (e) {
    console.warn('Rota: bildirim açılamadı', e);
    toast(/sunucu/.test(String(e && e.message)) ? 'Hatırlatma sunucusu henüz kurulmamış.' : 'Bildirim açılamadı. Yeniden dene.', {ms: 4500});
  } finally { busy(btn, false); refreshNotify(); render(); }
}
async function notifyOff(btn) {
  busy(btn, true);
  try {
    const reg = await swReg(), sub = await reg.pushManager.getSubscription();
    if (sub) { const id = await subId(sub.endpoint); write('push/' + id, () => db.doc('push/' + id).delete()); await sub.unsubscribe().catch(() => {}); }
    S.push.sub = null; toast('Hatırlatmalar kapalı');
  } catch (e) { console.warn(e); } finally { busy(btn, false); refreshNotify(); render(); }
}
async function notifyTest(quiet) {
  try {
    await window.RotaSync.flush();
    const {data} = await S.client.auth.getSession(), tok = data && data.session && data.session.access_token;
    if (!tok) throw new Error('oturum');
    const r = await fetch(FN_URL, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + tok}, body: JSON.stringify({test: true})});
    const j = await r.json().catch(() => ({}));
    if (!quiet || !j.sent) toast(j.sent ? 'Deneme gönderildi. Birkaç saniye içinde gelir.' : 'Deneme gönderilemedi. Sunucu kurulumunu kontrol et.', {ms: 4000});
  } catch (e) { toast('Deneme gönderilemedi.'); }
}
function notifyCard() {
  if (!pushSupported()) return `<div class="set-card"><div class="set-sync"><strong>Hatırlatmalar</strong><small>Bu tarayıcı bildirim desteklemiyor. Android’de Chrome’dan yüklenen uygulamada çalışır.</small></div></div>`;
  const on = pushOn(), denied = Notification.permission === 'denied', lead = Number(notifyPrefs().lead) || 0;
  return `<div class="set-card col"><div class="set-line"><span class="bell${on ? ' on' : ''}" aria-hidden="true">${BELL}</span><div class="set-sync"><strong>Hatırlatmalar ${on ? 'açık' : 'kapalı'}</strong>
      <small>${on ? 'Saati gelen blok ve iş telefona bildirim olarak gelir; uygulama kapalıyken de.' : denied ? 'Bildirim izni kapalı: Chrome > Site ayarları > Bildirimler’den aç.' : 'Saatli her blok ve iş için telefona bildirim.'}</small></div>
      <button class="btn2" type="button" data-act="${on ? 'notifyOff' : 'notifyOn'}"><span>${on ? 'Kapat' : 'Aç'}</span></button></div>
    ${on ? `<div class="seg" role="radiogroup" aria-label="Ne zaman">${[[0, 'Saatinde'], [5, '5 dk önce'], [10, '10 dk önce']].map(([v, l]) => `<label><input type="radio" name="lead" value="${v}"${lead === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <button class="link" type="button" data-act="notifyTest">Deneme bildirimi gönder</button>` : ''}</div>`;
}
function refreshNotify() { if (S.sheet === 'settings') { const el = $('#setNotify'); if (el) el.innerHTML = notifyCard(); } }
function notifyPrompt() {
  if (!S.push.checked || !pushSupported() || pushOn() || Notification.permission === 'denied' || flag('rota-notify-dismissed')) return '';
  return `<div class="cta"><span class="bell" aria-hidden="true">${BELL}</span><div class="cta-t"><b>Hatırlatmaları aç</b><small>Her maddenin saatinde telefona bildirim gelsin.</small></div>
    <button class="mini" type="button" data-act="notifyOn">Aç</button><button class="x-btn" type="button" data-act="notifyDismiss" aria-label="Kapat">${X_ICON}</button></div>`;
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
    <div id="setNotify">${notifyCard()}</div>
    ${shared() ? `<div class="set-card space-card"><div class="set-sync"><strong>Ortak alan · ${esc(S.spaceName || 'Ortak')}</strong>
      <small>${esc([S.me, ...partners()].map(k => k === S.me ? `${memberName(k)} (sen)` : memberName(k)).join(', '))}. Plan, işler, göstergeler, fikirler ve haftalık değerlendirmeler ortak; günlük program, enerji ve “Sadece ben” işleri sana özel.</small></div></div>` : ''}
    <div class="set-list">
      <button class="set-row" type="button" data-act="rewards"><span>Puan ve ödüller</span>${CHEV_R}</button>
      <button class="set-row" type="button" data-act="planSettings"><span>Planı düzenle</span>${CHEV_R}</button>
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
  try { if (id) localStorage.removeItem(memKey(id)); } catch (e) { /* önemsiz */ }
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
  // Bildirime dokununca açık uygulama Bugün sekmesine geçer.
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'GOTAB' && TABS.includes(d.tab) && S.running) { closeSheet(); goTab(d.tab); }
  });
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
  el.dataset.armed = '1'; el.classList.add('armed'); const old = el.innerHTML; el.textContent = label;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.classList.remove('armed'); el.innerHTML = old; } }, 3500);
}
function toggleTask(task, el) {
  const id = task.id, path = taskPath(task), v = !task.done;
  const patch = {done: v, doneAt: v ? todayKey() : null, doneBy: v ? (S.me || null) : null};
  const back = {done: !!task.done, doneAt: task.doneAt ?? null, doneBy: task.doneBy ?? null};
  S.gx = null; const before = game();
  if (v) { S.pop = id; buzz(); }
  localTask(id, patch);
  write(path, () => db.doc(path).update(patch));
  syncFull(task.due);
  const gain = v ? reward(before, el) : 0;
  if (v) toast(gain ? `Tamamlandı · +${gain} puan` : 'Tamamlandı', () => { localTask(id, back); write(path, () => db.doc(path).update(back)); syncFull(task.due); });
}
function toggleBlock(k, id, el) {
  const v = !isDone(k, id);
  S.gx = null; const before = game();
  if (v) { S.pop = k + ':' + id; buzz(); }
  localDay(k, {done: {[id]: v}}); upsert('days/' + k, {done: {[id]: v}}, {date: k});
  syncFull(k);
  if (v) reward(before, el, id);
}
function pullToday(task, el) {
  const k = todayKey(), time = suggestSlot(k, taskMin(task), task.area, task.id) || task.time || null, path = taskPath(task), patch = {due: k, time};
  localTask(task.id, patch); write(path, () => db.doc(path).update(patch));
  syncFull(k);
  toast(time ? `Bugüne alındı · ${time}` : 'Bugüne alındı. Saat vermek için dokun.');
}
function buyReward(r) {
  const g = game();
  if (g.balance < r.cost) { toast('Cüzdanda yeterli puan yok.'); return; }
  setPrefs({spent: [...spentList(), {id: 's' + Date.now().toString(36), rid: r.id, title: r.title, cost: Number(r.cost) || 0, at: new Date().toISOString()}]});
  if (r.joker) { const k = todayKey(); localDay(k, {joker: true}); upsert('days/' + k, {joker: true}, {date: k, done: {}}); syncFull(k); }
  toast(r.joker ? 'Joker kullanıldı: bu akşam izin, zincirler güvende.' : `Afiyet olsun · −${nf.format(r.cost)} puan`, {ms: 3200});
  openSheet(rewardsSheet(), null, 'rewards'); render();
}
function openAdd(ds) {
  const due = ds.due || (!ds.phase && S.tab === 'bugun' ? todayKey() : '');
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
    case 'toggleTask': if (task) { toggleTask(task, el); if (el.dataset.close) closeSheet(); } break;
    case 'pullToday': if (task) { pullToday(task, el); if (el.dataset.close) closeSheet(); } break;
    case 'toggleBlock': toggleBlock(el.dataset.date, id, el); if (el.dataset.close) closeSheet(); break;
    case 'detail': { const html = detailSheet(el.dataset.k, id, el.dataset.date); if (html) openSheet(html, null, 'detail'); break; }
    case 'dayOpen': S.openDays[el.dataset.date] = el.getAttribute('aria-expanded') !== 'true'; draw(); break;
    case 'rewards': openSheet(rewardsSheet(), null, 'rewards'); break;
    case 'buyReward': { const r = rewards().find(x => x.id === id); if (r) arm(el, 'Emin misin?', () => buyReward(r)); break; }
    case 'delReward': arm(el, 'Sil', () => { setPrefs({rewards: rewards().filter(x => x.id !== id)}); openSheet(rewardsSheet(), null, 'rewards'); }); break;
    case 'notifyOn': notifyOn(el); break;
    case 'notifyOff': notifyOff(el); break;
    case 'notifyTest': notifyTest(false); break;
    case 'notifyDismiss': setFlag('rota-notify-dismissed'); render(); break;
    case 'setBad': { const k = el.dataset.date, v = el.dataset.v === '1'; if (!!dayDoc(k).bad !== v) { localDay(k, {bad: v}); upsert('days/' + k, {bad: v}, {date: k, done: {}}); syncFull(k); } break; }
    case 'energy': { const k = el.dataset.date, n = Number(el.dataset.n), v = dayDoc(k).energy === n ? 0 : n; localDay(k, {energy: v}); upsert('days/' + k, {energy: v}, {date: k, done: {}}); break; }
    case 'review': openSheet(reviewForm(el.dataset.week), null, 'review'); break;
    case 'weekPrev': S.weekOff = Math.max(-20, S.weekOff - 1); draw(); break;
    case 'weekNext': S.weekOff = Math.min(12, S.weekOff + 1); draw(); break;
    case 'tplEdit': S.tplEdit = true; S.enter = true; draw(); window.scrollTo(0, 0); break;
    case 'tplDone': S.tplEdit = false; S.enter = true; draw(); break;
    case 'editBlock': { const b = S.routine.find(x => x.id === id); if (b) openSheet(blockForm(b), null, 'block'); break; }
    case 'addBlock': openSheet(blockForm(null, Number(el.dataset.dow)), '#b-title', 'block'); break;
    case 'phase': { const fp = focusPhase(); S.open[id] = !(S.open[id] ?? (fp && fp.id === id)); draw(); break; }
    case 'metrics': openSheet(metricsForm(), null, 'metrics'); break;
    case 'gold': openSheet(goldForm(), null, 'gold'); break;
    case 'delIdea': arm(el, 'Emin misin?', () => write('ideas/' + id, () => db.doc('ideas/' + id).delete())); break;
    case 'delTask': if (task) arm(el, 'Emin misin? Sil', () => {
      const copy = plain(task), path = taskPath(task); closeSheet();
      S.tasks = S.tasks.filter(t => t.id !== id); render();
      write(path, () => db.doc(path).delete());
      toast('Silindi', () => write(path, () => db.doc(path).set(copy)));
    }); break;
    case 'listFilter': S.listFilter = el.dataset.v || 'all'; draw(); break;
    case 'addPhase': openSheet(phaseForm(null), '#ph-title', 'phase'); break;
    case 'editPhase': { const p = S.phases.find(x => x.id === id); if (p) openSheet(phaseForm(p), null, 'phase'); break; }
    case 'delPhase': arm(el, 'Emin misin? Sil', () => {
      // Aşamanın işleri silinmez, gelen kutusuna düşer.
      const orphans = S.tasks.filter(t => t.phase === id);
      closeSheet();
      orphans.forEach(t => { const path = taskPath(t); write(path, () => db.doc(path).update({phase: null, kind: 'task'})); });
      write('phases/' + id, () => db.doc('phases/' + id).delete()).then(ok => ok && toast(orphans.length ? `Silindi · ${orphans.length} iş gelen kutusunda` : 'Silindi'));
    }); break;
    case 'planSettings': openSheet(planForm(), null, 'plan'); break;
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
  if (e.target.id === 'g-month') $('#g-gr').value = goldMonths()[e.target.value] ?? '';
  if (e.target.name === 'vis' && e.target.form) e.target.form.classList.toggle('is-private', e.target.value === 'ben');
  if (e.target.name === 'lead' && e.target.closest('#setNotify')) { setPrefs({notify: {...notifyPrefs(), lead: Number(e.target.value) || 0}}); toast('Kaydedildi'); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });
document.addEventListener('submit', e => {
  const f = e.target;
  if (!f.closest('#sheet')) return;   // giriş formları auth.js'te
  e.preventDefault();
  const fd = new FormData(f), str = k => String(fd.get(k) ?? '').trim();
  if (f.id === 'f-task') {
    const title = str('title'); if (!title) return;
    const priv = shared() && str('vis') === 'ben', colName = priv ? 'mytasks' : 'tasks';
    const id = f.dataset.id, old = id ? S.tasks.find(t => t.id === id) : null;
    const due = str('due') || null, min = Math.round(Number(str('min'))) || null, area = str('area') || defaultArea();
    // Tarihli işin saati boşsa o günün bloğunda ilk boş saate yerleşir.
    let time = /^\d\d:\d\d$/.test(str('time')) ? str('time') : null, auto = false;
    if (due && !time) { time = suggestSlot(due, min || 30, area, id) || null; auto = !!time; }
    const data = {title, note: str('note'), due, time, min, phase: priv ? null : str('phase') || null, area,
      who: priv ? S.me : str('who') || (shared() ? S.me : 'ben'), kind: !priv && fd.get('gate') ? 'gate' : 'task'};
    closeSheet();
    if (auto) setTimeout(() => toast(`Saat verildi: ${dueLabel(due)[0]} ${time}`), 2300);
    if (old && old._col !== colName) {
      // Görünürlük değişti: belge diğer koleksiyona taşınır (aynı kimlikle).
      const moved = {...plain(old), ...data};
      S.tasks = S.tasks.filter(t => t.id !== id); render();
      write(`${colName}/${id}`, () => db.doc(`${colName}/${id}`).set(moved))
        .then(ok => ok && write(taskPath(old), () => db.doc(taskPath(old)).delete()))
        .then(ok => ok && toast(priv ? 'Sadece sana görünür' : 'Ortak plana taşındı'));
    } else if (old) { localTask(id, data); write(taskPath(old), () => db.doc(taskPath(old)).update(data)).then(ok => ok && toast('Kaydedildi')); }
    else write(colName + '/new', () => db.collection(colName).add({...data, done: false, doneAt: null, createdAt: new Date().toISOString(), createdBy: S.me || null, order: Date.now()}))
      .then(ok => ok && toast('Eklendi'));
  } else if (f.id === 'f-reward') {
    const title = str('title'), cost = Math.round(Number(str('cost')));
    if (!title || !(cost >= 10)) return;
    setPrefs({rewards: [...rewards(), {id: 'w' + Date.now().toString(36), title, cost}]});
    openSheet(rewardsSheet(), null, 'rewards'); toast('Ödül eklendi');
  } else if (f.id === 'f-idea') {
    const text = str('text'); if (!text) return; closeSheet();
    write('ideas/new', () => db.collection('ideas').add({text, by: S.me || null, createdAt: new Date().toISOString()})).then(ok => ok && toast('Fikir defterine eklendi'));
  } else if (f.id === 'f-block') {
    const title = str('title'); if (!title) return;
    const data = {title, note: str('note'), dow: Number(str('dow')), start: str('start'), end: str('end'), area: str('area') || defaultArea(), min: Number(str('min')) || 0, core: !!fd.get('core')};
    const id = f.dataset.id; closeSheet();
    if (id) write('routine/' + id, () => db.doc('routine/' + id).update(data)).then(ok => ok && toast('Kaydedildi'));
    else write('routine/new', () => db.collection('routine').add({...data, order: Date.now()})).then(ok => ok && toast('Eklendi'));
  } else if (f.id === 'f-review') {
    const w = f.dataset.week; closeSheet();
    upsert('weeks/' + reviewId(w), {good: str('good'), stuck: str('stuck'), next: str('next'), updatedAt: new Date().toISOString()}, {week: w, by: S.me || null})
      .then(ok => ok && toast('Kaydedildi'));
  } else if (f.id === 'f-metrics') {
    const incRaw = str('inc');
    const patch = {clients: Math.max(0, Math.round(Number(str('cli')) || 0)), income: {[str('month')]: incRaw === '' ? null : Math.max(0, Number(incRaw) || 0)}};
    if (fd.has('sav')) patch.savingsEur = Math.max(0, Number(str('sav')) || 0);
    closeSheet();
    upsert('metrics/main', patch, {}).then(ok => ok && toast('Kaydedildi'));
  } else if (f.id === 'f-gold') {
    const month = str('month'), raw = str('gr'), tgt = str('tgt'), v = raw === '' ? null : Number(raw);
    if (!/^\d{4}-\d{2}$/.test(month) || (v != null && !Number.isFinite(v))) return;
    closeSheet();
    setPrefs({gold: {target: tgt === '' ? null : Math.max(0, Number(tgt) || 0), m: {...goldMonths(), [month]: v}}}).then(ok => ok && toast('Kaydedildi'));
  } else if (f.id === 'f-phase') {
    const title = str('title'), no = str('no'); if (!title || !no) return;
    const n = planMonths(), month = k => { const v = Math.round(Number(str(k))); return str(k) !== '' && v >= 1 && v <= n ? v : null; };
    const gateLabel = str('gateLabel'), gm = month('gateMonth');
    const data = {no, title, label: str('label'), start: month('start'), end: month('end') ?? month('start'), gateLabel, gateShort: gateLabel, gateMonth: gateLabel ? gm : null};
    const id = f.dataset.id; closeSheet();
    if (id) write('phases/' + id, () => db.doc('phases/' + id).update(data)).then(ok => ok && toast('Kaydedildi'));
    else {
      const order = S.phases.reduce((m, p) => Math.max(m, Number(p.order) || 0), -1) + 1;
      write('phases/new', () => db.collection('phases').add({...data, order})).then(ok => ok && toast('Aşama eklendi'));
    }
  } else if (f.id === 'f-plan') {
    const title = str('title'); if (!title) return;
    const months = Math.round(Number(str('months'))), start = str('start'), inc = str('inc'), cli = Math.round(Number(str('cli')));
    const sPatch = {planTitle: title, planSub: str('sub'), currency: CURRENCIES.includes(str('cur')) ? str('cur') : currency()};
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) sPatch.planStart = start.slice(0, 8) + '01';
    if (months >= 1 && months <= 120) sPatch.planMonths = months;
    const mPatch = {incomeTarget: inc === '' ? null : Math.max(0, Number(inc) || 0)};
    if (cli >= 1) mPatch.clientsTarget = cli;
    closeSheet();
    Promise.all([upsert('settings/app', sPatch, {}), upsert('metrics/main', mPatch, {clients: 0, income: {}})])
      .then(r => r.every(Boolean) && toast('Plan kaydedildi'));
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

/* ---------- ortak alan üyeliği ----------
   Üyelik cihazda saklanır: açılış ağ beklemez, çevrimdışı da aynı alanla açılır. Arka planda tazelenir;
   değişmişse uygulama yeniden yüklenir. */
const memKey = uid => 'rota-space-' + uid;
function cachedMembership(uid) {
  try { const m = JSON.parse(localStorage.getItem(memKey(uid)) || 'null'); return m && typeof m === 'object' ? m : null; } catch (e) { return null; }
}
// Başarılı sorguda {space, slug, spaceName} ya da {space: null}; ağ/sunucu hatasında null.
async function fetchMembership(client, uid, ms) {
  try {
    const q = client.from('space_members').select('space,slug,name,spaces(name)').eq('user_id', uid).order('created_at').limit(1);
    const r = await Promise.race([q, new Promise(res => setTimeout(() => res({error: {message: 'timeout'}}), ms))]);
    if (r.error) return null;
    const row = (r.data || [])[0];
    return row ? {space: row.space, slug: row.slug, spaceName: (row.spaces && row.spaces.name) || ''} : {space: null};
  } catch (e) { return null; }
}
const sameMem = (a, b) => (a && a.space || null) === (b && b.space || null) && (a && a.slug || null) === (b && b.slug || null);

/* ---------- dışa açık ---------- */
window.RotaUI = Object.freeze({esc, pwField, busy, toast});
window.RotaApp = Object.freeze({
  async start(user, client) {
    if (S.running) return;
    S.running = true; S.user = user; S.client = client; db = window.RotaDB;
    let mem = cachedMembership(user.id);
    if (!mem && navigator.onLine) {
      mem = await fetchMembership(client, user.id, 5000);
      if (mem) { try { localStorage.setItem(memKey(user.id), JSON.stringify(mem)); } catch (e) { /* önemsiz */ } }
    }
    S.space = (mem && mem.space) || null; S.me = S.space ? mem.slug : null; S.spaceName = (mem && mem.spaceName) || '';
    S.sync = window.RotaSync.status();
    window.RotaSync.onStatus(st => { S.sync = st; syncUI(); });
    window.RotaSync.start({client, userId: user.id, space: S.space, shared: SHARED}).catch(e => console.warn('Rota: eşitleme başlatılamadı', e));
    initNav();
    listen();
    draw();
    showInstall();
    pushInit();
    if (navigator.onLine) fetchMembership(client, user.id, 15000).then(fresh => {
      if (!fresh) return;
      try { localStorage.setItem(memKey(user.id), JSON.stringify(fresh)); } catch (e) { /* önemsiz */ }
      if (!sameMem(fresh, mem)) location.reload();
      else if (fresh.spaceName && fresh.spaceName !== S.spaceName) S.spaceName = fresh.spaceName;
    });
  },
  running: () => S.running,
  userId: () => S.user && S.user.id,
  setUser(u) { if (S.running && u && S.user && u.id === S.user.id) S.user = u; },
});
draw();
initSW();
})();
