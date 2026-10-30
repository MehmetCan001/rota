# Rota 2028

Günlük program, haftalık düzen ve uzun vadeli plan takibi için kişisel bir uygulama (PWA). Android'de Chrome ile
"Uygulamayı yükle" denince tam ekran açılır ve internetsiz de çalışır.

## Nasıl yayınlanır

Derleme adımı yok: bu klasördeki düz dosyalar (HTML, CSS, JavaScript) GitHub Pages ile olduğu gibi sunulur.
Bütün yollar göreli olduğu için alt dizinden (`/rota/`) sorunsuz çalışır. `.nojekyll` dosyası Pages'in dosyaları
işlemeden sunmasını sağlar.

Yeni sürüm çıkarken `version.js` içindeki `APP_VERSION` artırılır. Service worker önbelleği bu numarayla
yenilenir; açık uygulamada "Yeni sürüm hazır · Yenile" bildirimi çıkar.

## Veri nerede

Bu depoda hiçbir kişisel veri yok. Görevler, program ve plan ayarları kullanıcının kendi Supabase projesinde,
satır düzeyinde güvenlik (RLS) ile korunan bir tabloda durur: her hesap yalnız kendi kayıtlarını görür.
Koddaki Supabase anahtarı herkese açık olmak üzere tasarlanmış "publishable" anahtardır; erişimi RLS belirler.

Uygulama yerel önceliklidir: veriler cihazda (IndexedDB) da tutulur, değişiklikler önce cihaza yazılır ve
bağlantı olunca sırayla buluta gönderilir. Hesaplar davetle açılır; uygulamada kayıt olma yoktur.

## Dosyalar

- `index.html`, `styles.css`: kabuk ve görünüm
- `app.js`: ekranlar (Bugün, Hafta, Plan, Liste, ayarlar)
- `db.js`: yerel öncelikli veri katmanı ve eşitleme
- `auth.js`: giriş ve ilk girişte şifre belirleme
- `sw.js`, `manifest.webmanifest`, `version.js`: PWA
- `vendor/`, `fonts/`: Supabase istemcisi ve yerel yazı tipleri (lisansları yanlarında)
