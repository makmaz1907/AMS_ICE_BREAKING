# Bir Kelime Bir İşlem — Geliştirme Notları

## Son durum

- **Proje:** Vite + React + TypeScript istemcisi ve Vercel'de çalışan durumsuz bir HTTP API. Oyun verisi Upstash Redis'te tutuluyor, anlık bildirimler Ably ile gidiyor.
- **Production:** https://bir-kelime-bir-islem-phi.vercel.app
  - Host ekranı: `/host`
  - Telefonlar: `/join`
- **Yerel geliştirme:** `run-dev.bat` veya `npm run dev`.
  - Yerelde hiçbir anahtar gerekmez; veri bellekte tutulur.
  - Sunucu yeniden başlayınca oyun sıfırlanır.
- **Yerel adresler:**
  - Host: `http://localhost:5173/host`
  - Telefon: host ekranındaki QR kodun gösterdiği LAN adresi. Telefonda `localhost` kullanılmamalı.
- **Host PIN'i:**
  - Yerelde varsayılan `1234`.
  - Vercel'de `HOST_PIN` ortam değişkeninden gelir ve varsayılanı yoktur. Production ve Preview'un PIN'leri farklıdır.
- **Dağıtım:** `npx vercel deploy` (önizleme) veya `npx vercel deploy --prod`. GitHub deposu Vercel'e bağlı olmadığı için `main`'e gönderilen kod kendiliğinden yayına çıkmaz.

## Uygulanan özellikler

### Lobi ve bağlantı

- Telefonlar ve host anlık güncellenir. Vercel'de Ably, yerelde SSE bildirim gönderir; sayfa ardından güncel durumu sunucudan çeker.
- QR kod, Vercel'de sitenin adresini, yerelde makinenin LAN adresini gösterir.
- Telefon, takım anahtarını `localStorage`'da saklar. Sayfa yenilenince veya bağlantı kopup gelince aynı takımla otomatik geri katılır; puan korunur.
- Takım anahtarı imzalıdır ve takımın herkese görünen kimliğinden ayrıdır. Başka biri bir takımın yerine cevap gönderemez.
- **Host onayı:**
  - Yeni takımlar host onaylayana kadar bekler. Host onayı lobiden açıp kapatabilir; varsayılanı açık.
  - Bekleyen adlar projeksiyonda görünmesin diye "Göster"e basılana kadar gizlidir.
  - Host takımları tek tek onaylayabilir, reddedebilir veya "Tümünü onayla" diyebilir.
  - Host onaylı bir takımı sonradan çıkarabilir. Çıkarma iki tıklama ister ("Çıkar" → "Emin misiniz?").
  - Reddedilen veya çıkarılan takım yalnızca farklı bir adla tekrar başvurabilir. Onaylanan takımın adı sonradan değiştirilemez.
- **Oyunu sıfırla:** takımları ve puanları siler, eski takım anahtarlarını geçersiz kılar. Telefonlar kendiliğinden başvurmaz: katılım formuna döner, eski ad kutuda hazır durur ve oyuncu "Oyuna katıl"a basınca yeni başvuru yapılır.

### Oyun akışı

- Oyun planı `config/game.json` dosyasından okunur. Varsayılan sıra:
  - 3 kelime turu × 60 saniye
  - 2 işlem turu × 90 saniye
- Host kontrolleri:
  - Tur başlat / bitir
  - Süreyi durdur / devam ettir
  - +15 saniye ekle
  - Katılım onayı
  - Oyunu sıfırla
- Sunucuda zamanlayıcı yok. Süre dolunca turu, bunu ilk fark eden kapatır: host'un veya bir telefonun sayacı, ya da bir durum isteği. Tur yalnızca bir kez kapanır.
- Toplam puanlar turlar boyunca korunur. Son turdan sonra "Yeni oyun", takımları tutar ve puanları sıfırlar.
- Finalde ilk üç takım gösterilir. Sonuçlar CSV (Excel için BOM'lu) ve JSON olarak indirilebilir.

### Kelime turu

- 8 harf + 1 joker. Harfler tam olarak 3 sesli ve 5 sessizden oluşur; seçim Türkçe harf sıklığına göre ağırlıklıdır.
- `tr-TR` normalizasyonu kullanılır. I/İ, O/Ö, U/Ü, G/Ğ ve C/Ç birbirinin yerine geçebilir.
- Joker yalnızca oyuncunun ★ ile işaretlediği harfin yerine geçer. Telefon, turda olmayan harflerin yazılmasına izin vermez.
- **Sözlük:** kelimeler canlı TDK sözlüğünden (`sozluk.gov.tr`) doğrulanır ve sonuçlar 7 gün önbellekte tutulur.
  - Elle onay yoktur: TDK'da bulunmayan kelime reddedilir.
  - TDK'ya ulaşılamazsa takım hata mesajı alır ve hiçbir şey kaydedilmez.
  - TDK anlamları, host'un tur sonucu ekranında gösterilir.
- Takım bir turda birden fazla farklı kelime gönderebilir; her kabul edilen kelime puan getirir. Aynı kelime ikinci kez kabul edilmez.
- Puan: harf sayısı. Jokersiz 9 harfli kelimeye +5 bonus.

### İşlem turu

- 5 tek basamaklı sayı + 1 büyük sayı (10, 25, 50, 75 veya 100). Hedef 100–999 arasında.
- Dört işlem ve parantez desteklenir.
- `eval` kullanılmaz; `server/numberGame.ts` içindeki ayrıştırıcı kullanılır.
- Her sayı en fazla bir kez kullanılabilir. Bölme tam olmalı, ara sonuçlar pozitif tam sayı olmalıdır.
- Puanlar tur kapanınca verilir; her takımın hedefe en yakın cevabı sayılır.
  - Hedefi tam bulan varsa o takım(lar) 10 puan alır, diğer herkes 0.
  - Tam isabet yoksa geçerli cevap veren N takım uzaklığa göre sıralanır: en yakın N, sonraki N-1, … en uzak 1 puan. Eşit uzaklıktakiler aynı puanı alır.
  - Geçerli cevap göndermeyen takım 0 puan alır.
- Sunucu tur başında en iyi çözümü hesaplar. Çözüm tur bitene kadar gizli kalır, sonra host ekranında gösterilir.

### Tema

- PDF'deki NTT DATA marka değerleri ayrı bir dosyada: `src/theme.css`.
- Ana renkler:
  - Future Blue: `#0072BC`
  - Smart Navy: `#070F26`
  - Turquoise: `#00DFED`
- `src/styles.css` genel arka plan, panel, odak ve hareket stillerini içerir.

## Önemli dosyalar

- `server/engine.ts`: oyun kuralları, tur geçişleri, puanlama, katılım ve host onayı.
- `server/store.ts`, `server/redisStore.ts`: verinin bellekte ve Redis'te tutulması.
- `server/api.ts`: bütün `/api` adresleri. `api/[...path].ts`: Vercel'deki tek fonksiyon.
- `server/dev.ts`: yerel geliştirme sunucusu.
- `server/wordGame.ts`, `server/tdk.ts`: kelime turu kuralları ve TDK sorgusu.
- `server/numberGame.ts`: işlem ayrıştırma, puanlama ve çözücü.
- `config/game.json`: tur planı ve isteğe bağlı oyun ayarları.
- `src/pages/HostPage.tsx`: host/projeksiyon arayüzü.
- `src/pages/JoinPage.tsx`: telefon arayüzü.
- `src/game.ts`, `src/realtime.ts`: durum çekme, anlık bildirimler ve sayaç.
- `src/types.ts`: istemci tarafındaki oyun durumu tipleri.
- `src/theme.css`: marka renkleri ve yazı tipi önceliği.

## Doğrulananlar

- `npm run build` başarılı.
- **Elle çalıştırılan test betikleri** hem yerelde hem Vercel önizlemesinde (Redis + Ably) geçti. Depoda kalıcı bir test paketi yok.
  - Joker kuralları, tekrar eden cevap, TDK doğrulaması.
  - Durdurma ve süre ekleme, işlem kuralları, çözücü.
  - Sıfırlama, CSV/JSON dışa aktarma, PIN deneme sınırı.
  - Host onayının tüm durumları.
- **Eşzamanlılık:**
  - Aynı cevabın 5 paralel gönderiminden yalnızca biri puan aldı.
  - 20 paralel katılımın hepsi kaydedildi.
  - 10 paralel "+15 sn" komutunun hepsi uygulandı.
  - Süre dolunca gelen 20 paralel istekten tur yalnızca bir kez kapandı.
- **Tarayıcı (yerel):** katılım, jokerli kelime, sayfa yenileyince geri katılım, sürenin dolmasıyla turun kapanması, onay/ret/çıkarma ekranları.
- **Henüz yapılmadı:** Production'da gerçek telefonlarla baştan sona bir oyun.

## Kalan işler

Kullanıcının daha önceki isteğine göre kalite/dokümantasyon maddeleri (yük testi, birim testleri, README) bilinçli olarak dışarıda bırakıldı. Bunlar dışındaki belirgin eksikler:

1. Production'da gerçek telefonlarla tam bir oyun denemesi.
2. GitHub deposunu Vercel'e bağlamak, böylece `main`'e gönderilen kod kendiliğinden yayına çıksın.
3. ~~Logo bileşeni~~: yapıldı (NTT DATA logosu, LE AMS etkinlik logosu, "powered by aXet").
4. `config/game.json` içindeki `themedWord` ayarının harf üretimine gerçekten uygulanması. Şu an yalnızca tur sonucunda metin olarak gösteriliyor.
5. `predefinedTeams` ile telefonda takım seçimi.
6. `teamMode: "individual"` davranışının gerçek oyun mantığına bağlanması.
7. ~~Ses efektleri~~: yapıldı. Host ekranında tur başı melodisi, son 30/10/5 saniyede sıklaşan tıkırtılar, tur bitişinde yumuşak bir çan akoru ve final açıklamasında davul ile fanfar var; alt şeritteki "Ses açık/kapalı" düğmesiyle kapatılabilir. Puan tablosu da host ayarıyla son iki turda ya da tüm oyun boyunca gizlenebiliyor; final sıralaması sondan başa açıklanıyor.
8. ~~Animasyonlu skor sırası~~: yapıldı (satırlar kayarak yer değiştirir, yeni puanın yanında "+N" balonu). Konfeti/podyum görseli de yenilendi.
9. Host'un tur sonucu ekranında en iyi kelimenin/cevabın daha belirgin vurgulanması.
10. ~~İşlem turunda telefonda ara sonuç~~: yapıldı; host lobideki "Oyun ayarları"ndan ya da işlem turu sırasında açıp kapatabilir.

## Dikkat

- `EADDRINUSE: 3000` hatası, eski bir yerel sunucunun hâlâ çalıştığını gösterir. Önce `stop-server.bat` çalıştırın.
- Kelime turları internet bağlantısı gerektirir, çünkü TDK sözlüğüne canlı sorgu atılır.
- **Host girişi:** IP başına 10 dakikada en fazla 10 deneme yapılabilir; başarılı girişler de sayılır. Sınır aşılırsa 10 dakika beklemek gerekir.
- **Vercel ortam değişkenleri** "Sensitive" olarak işaretli, `vercel env pull` ile yerele çekilemez. Redis ve Ably davranışı önizleme dağıtımında test edilmeli.
- **Önizleme dağıtımları** Vercel girişi ister; telefonlar bunları açamaz. Telefonla test Production'da yapılmalı.
- Kod değişikliğinden sonra tarayıcıda `Ctrl+F5` gerekebilir.
