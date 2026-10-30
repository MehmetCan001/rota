/* Rota oturumu: giriş, ilk girişte zorunlu şifre, kayıtlı oturumla ağ beklemeden açılış. */
(() => {
'use strict';
const SB_URL = 'https://ywwigizfvrcsljgjcqfe.supabase.co';
const SB_KEY = 'sb_publishable_kcpo7zyREBN-SI7UHneZJQ_CKQGhBpc';
const SKEY = 'rota-auth';
const $ = s => document.querySelector(s);
const UI = window.RotaUI, App = window.RotaApp;
const esc = UI.esc;

if (!window.supabase || !window.supabase.createClient) {
  console.error('Rota: Supabase istemcisi yüklenemedi.');
  return;
}
const client = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: SKEY},
});
let screen = '', loggingOut = false;

// Kayıtlı oturum eşzamanlı okunur: çevrimdışı açılışta ağ beklenmez.
function stored() {
  try { const s = JSON.parse(localStorage.getItem(SKEY) || 'null'); return s && s.user && s.user.id ? s : null; } catch (e) { return null; }
}
const offline = () => !navigator.onLine;
const isNet = e => !!e && (e.name === 'AuthRetryableFetchError' || e.status === 0 || /fetch|network/i.test(String(e.message || '')));

function loginError(e) {
  if (offline() || isNet(e)) return 'İnternet yok. Giriş için bağlantı gerekli.';
  if (e.status === 429 || e.code === 'over_request_rate_limit') return 'Çok fazla deneme. Biraz bekleyip yeniden dene.';
  if (e.code === 'invalid_credentials' || e.status === 400) return 'E-posta ya da şifre yanlış.';
  return 'Giriş yapılamadı. Biraz sonra yeniden dene.';
}
function pwError(e) {
  if (offline() || isNet(e)) return 'İnternet yok. Şifre değiştirmek için bağlantı gerekli.';
  const c = e && e.code;
  if (c === 'same_password') return 'Yeni şifre eskisiyle aynı olamaz.';
  if (c === 'weak_password') return 'Bu şifre çok zayıf. Daha uzun ya da tahmini zor bir şifre seç.';
  if (c === 'reauthentication_needed' || c === 'session_not_found' || (e && e.status === 401)) return 'Oturum süresi doldu. Çıkış yapıp yeniden gir.';
  if (e && e.status === 429) return 'Çok fazla deneme. Biraz bekleyip yeniden dene.';
  return 'Şifre kaydedilemedi. Yeniden dene.';
}

/* ---------- ekranlar ---------- */
function show(name, html) {
  screen = name;
  const a = $('#auth');
  a.innerHTML = html; a.hidden = false;
  $('#appRoot').hidden = true;
  document.body.classList.add('in-auth');
  window.scrollTo(0, 0);
}
function hide() {
  screen = '';
  const a = $('#auth');
  a.hidden = true; a.innerHTML = '';
  $('#appRoot').hidden = false;
  document.body.classList.remove('in-auth');
}
const hero = (eb, title, sub) => `<div class="auth-hero"><div class="auth-in">
  <img class="auth-mark" src="icons/icon.svg" alt="" width="56" height="56">
  <p class="auth-eb">${eb}</p><h1>${title}</h1><p class="auth-sub">${sub}</p></div></div>`;
function errBox(el, msg) { el.textContent = msg; el.hidden = !msg; }

function showLogin(note) {
  let expired = false;
  try { expired = sessionStorage.getItem('rota-expired') === '1'; sessionStorage.removeItem('rota-expired'); } catch (e) { /* önemsiz */ }
  const info = note || (expired ? 'Oturumun sona erdi. Yeniden giriş yap.' : '');
  show('login', `${hero('Rota 2028', 'Hoş geldin', 'Program, hafta ve plan tek yerde. Devam etmek için giriş yap.')}
    <div class="auth-card"><div class="auth-in">
      <form id="f-login" novalidate>
        ${info ? `<p class="form-info">${esc(info)}</p>` : ''}
        <div class="fld"><label for="l-email">E-posta</label><input id="l-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>
        ${UI.pwField('l-pass', 'Şifre', 'current-password')}
        <p class="form-err" id="l-err" role="alert" hidden></p>
        <button class="primary block" type="submit" id="l-btn"><span>Giriş yap</span></button>
      </form>
      <p class="auth-foot">Hesaplar davetle açılır.</p>
    </div></div>`);
  $('#f-login').addEventListener('submit', onLogin);
}
async function onLogin(e) {
  e.preventDefault();
  const email = $('#l-email').value.trim(), pw = $('#l-pass').value, er = $('#l-err'), btn = $('#l-btn');
  if (!email || !pw) { errBox(er, 'E-posta ve şifreyi gir.'); ($('#l-email').value ? $('#l-pass') : $('#l-email')).focus(); return; }
  if (offline()) { errBox(er, 'İnternet yok. Giriş için bağlantı gerekli.'); return; }
  errBox(er, ''); UI.busy(btn, true);
  let res;
  try { res = await client.auth.signInWithPassword({email, password: pw}); } catch (err) { res = {error: err}; }
  if (screen !== 'login') return;
  UI.busy(btn, false);
  if (res.error || !res.data || !res.data.user) { errBox(er, loginError(res.error || {})); $('#l-pass').select(); return; }
  route(res.data.user);
}

function showNewPassword(user) {
  show('newpw', `${hero('İlk giriş', 'Yeni şifre belirle', 'Hesabın geçici bir şifreyle açıldı. Devam etmeden önce sana özel bir şifre belirle.')}
    <div class="auth-card"><div class="auth-in">
      <form id="f-newpw" novalidate>
        <input class="vh" type="email" name="username" autocomplete="username" value="${esc(user.email || '')}" tabindex="-1" aria-hidden="true" readonly>
        ${UI.pwField('n-pass', 'Yeni şifre', 'new-password', 'En az 10 karakter.')}
        ${UI.pwField('n-pass2', 'Yeni şifre, tekrar', 'new-password')}
        <p class="form-err" id="n-err" role="alert" hidden></p>
        <button class="primary block" type="submit" id="n-btn"><span>Şifreyi kaydet</span></button>
      </form>
      <button class="link auth-alt" type="button" id="n-out">Çıkış yap</button>
    </div></div>`);
  $('#f-newpw').addEventListener('submit', onNewPassword);
  $('#n-out').addEventListener('click', async () => { await signOut(); location.replace(location.pathname); });
  setTimeout(() => { const f = $('#n-pass'); if (f) f.focus(); }, 50);
}
async function onNewPassword(e) {
  e.preventDefault();
  const a = $('#n-pass').value, b = $('#n-pass2').value, er = $('#n-err'), btn = $('#n-btn');
  if (a.length < 10) { errBox(er, 'Şifre en az 10 karakter olmalı.'); return; }
  if (a !== b) { errBox(er, 'Şifreler aynı değil.'); return; }
  if (offline()) { errBox(er, 'İnternet yok. Şifre değiştirmek için bağlantı gerekli.'); return; }
  errBox(er, ''); UI.busy(btn, true);
  let res;
  try { res = await client.auth.updateUser({password: a, data: {must_change_password: false}}); } catch (err) { res = {error: err}; }
  if (screen !== 'newpw') return;
  UI.busy(btn, false);
  if (res.error || !res.data || !res.data.user) { errBox(er, pwError(res.error || {})); return; }
  route(res.data.user);
}

/* ---------- yönlendirme ---------- */
function route(user) {
  if (user.user_metadata && user.user_metadata.must_change_password) { showNewPassword(user); return; }
  hide();
  App.start(user, client);
}
async function signOut() {
  loggingOut = true;
  try { await Promise.race([client.auth.signOut({scope: 'local'}), new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* yerelde yine silinir */ }
  ['', '-user', '-code-verifier'].forEach(s => { try { localStorage.removeItem(SKEY + s); } catch (e) { /* önemsiz */ } });
}

client.auth.onAuthStateChange((event, session) => {
  // Supabase geri çağrısı içinde başka auth çağrısı yapılmaz: bir sonraki tura bırak.
  setTimeout(() => {
    if (event === 'SIGNED_OUT') {
      if (loggingOut) return;
      if (App.running()) { try { sessionStorage.setItem('rota-expired', '1'); } catch (e) { /* önemsiz */ } location.reload(); }
      else if (screen !== 'login') showLogin('Oturumun sona erdi. Yeniden giriş yap.');
      return;
    }
    if (!session || !session.user) return;   // çevrimdışı ve süresi dolmuş oturum: önbellekten devam
    if (App.running()) {
      if (session.user.id !== App.userId()) { location.reload(); return; }
      App.setUser(session.user);
      window.RotaSync.kick();
    }
  }, 0);
});

window.RotaAuth = Object.freeze({
  client,
  signOut,
  pwError,
  async updatePassword(pw) {
    const {data, error} = await client.auth.updateUser({password: pw});
    if (error) throw error;
    if (data && data.user) App.setUser(data.user);
    return data && data.user;
  },
});

const s = stored();
if (s) route(s.user); else showLogin();
})();
