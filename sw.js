/* Rota service worker: sürümlü uygulama kabuğu önbelleği. Supabase istekleri asla önbelleğe alınmaz. */
importScripts('version.js');
const VERSION = self.APP_VERSION || '0';
const PREFIX = 'rota-shell-';
const CACHE = PREFIX + VERSION;
const CORE = [
  'index.html', 'styles.css', 'app.js', 'db.js', 'auth.js', 'version.js', 'vendor/supabase.js', 'manifest.webmanifest',
  'fonts/fonts.css', 'fonts/BricolageGrotesque-latin.woff2', 'fonts/BricolageGrotesque-latin-ext.woff2',
  'fonts/Onest-latin.woff2', 'fonts/Onest-latin-ext.woff2',
];
// Simgeler eksik olsa da kurulum başarısız olmasın.
const OPTIONAL = [
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'icons/favicon-32.png', 'icons/shortcut-today.png', 'icons/shortcut-week.png', 'icons/shortcut-plan.png', 'icons/shortcut-add.png',
];
const abs = p => new URL(p, self.location).href;
const SHELL = abs('index.html');
const SCOPE = new URL('./', self.location).pathname;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE.map(p => new Request(abs(p), {cache: 'reload'})));
    await Promise.all(OPTIONAL.map(p => fetch(new Request(abs(p), {cache: 'reload'}))
      .then(r => (r.ok ? c.put(abs(p), r) : null)).catch(() => null)));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Sayfa "Yenile" deyince bekleyen sürüm devreye girer.
self.addEventListener('message', e => {
  const d = e.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Sayfa açılışları: önbellekteki kabuk hemen döner (çevrimdışı da), ağ beklenmez.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const hit = await caches.match(SHELL, {cacheName: CACHE});
      if (hit) return hit;
      try { return await fetch(req); } catch (err) { return (await caches.match(SHELL)) || Response.error(); }
    })());
    return;
  }

  if (!url.pathname.startsWith(SCOPE)) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, {cacheName: CACHE, ignoreSearch: true});
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  })());
});
