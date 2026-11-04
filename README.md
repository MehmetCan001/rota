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

## Ortak alan

Bir hesap bir ortak alana (`spaces`, üyelik `space_members`) üye olabilir. Üyeyse plan, aşamalar, ortak işler,
göstergeler, fikirler ve haftalık değerlendirmeler alanın sahipliğinde durur ve ortaklar aynı kayıtları görür;
günlük program, günler, "Sadece ben" işleri ve kişisel ayarlar kullanıcıya özel kalır. Erişim yine RLS ile
belirlenir: kullanıcı kendi kayıtlarını ve üyesi olduğu alanın kayıtlarını görür. Üyelik yalnız SQL ile verilir.

## Hatırlatmalar (1.2)

Saatli program blokları ve işler telefona Web Push bildirimi olarak gelir; uygulama kapalıyken de. Sunucu tarafı
`supabase/functions/rota-remind` (Edge Function, dış paket yok) ve `supabase/cron.sql` (pg_cron her dakika çağırır).
Abonelik kişisel `push` koleksiyonunda durur. VAPID anahtarları fonksiyonun ilk çağrısında üretilir ve sistem sahibiyle
(`00000000-…`) saklanır; RLS kullanıcıların görmesini engeller. Aynı hatırlatma iki kez gitmez (`pushlog` talebi).
Kurulum: fonksiyonu "Verify JWT" kapalı yayınla, sonra `cron.sql`'i SQL Editor'de çalıştır.

## Puan ve ödüller (1.2)

Puan kayıtlardan hesaplanır: blok +10, iş +20, kapı şartı +50, tam gün +25, haftalık değerlendirme +30, zincir bonusları.
"Tam gün" gün belgesine (`full`) işlenir. Ödüller ve harcamalar kişisel ayarlarda (`prefs/app`: `rewards`, `spent`);
joker ödülü günü izinli yapar (`days/<tarih>.joker`), zincir kırılmaz ve o gün hatırlatma gitmez.

## Dosyalar

- `index.html`, `styles.css`: kabuk ve görünüm
- `app.js`: ekranlar (Bugün, Hafta, Plan, Liste, ayarlar)
- `db.js`: yerel öncelikli veri katmanı ve eşitleme
- `auth.js`: giriş ve ilk girişte şifre belirleme
- `sw.js`, `manifest.webmanifest`, `version.js`: PWA
- `vendor/`, `fonts/`: Supabase istemcisi ve yerel yazı tipleri (lisansları yanlarında)
