# Bir Kelime Bir İşlem — Geliştirme Notları

## Son durum

- Proje: Vite + React + TypeScript istemcisi; Express + Socket.IO sunucusu.
- Çalışma klasörü: `C:\Users\10128621\Desktop\icebraker`
- Yerel geliştirme başlatma: `run-dev.bat` veya `npm run dev`
- Sunucuyu kapatma: `stop-server.bat` (`3000` portundaki işlemi kapatır).
- Host: `http://localhost:5173/host`
- Varsayılan host PIN: `1234` (`HOST_PIN` ortam değişkeniyle değiştirilebilir).
- Telefon bağlantısı: Host ekranındaki QR/LAN adresi kullanılmalı; telefonda `localhost` kullanılmamalı.

## Uygulanan özellikler

### Lobi ve bağlantı

- Socket.IO ile gerçek zamanlı lobi ve takım listesi.
- QR kod, LAN IP’sine göre üretilir.
- Mobil istemci otomatik yeniden bağlanır ve `localStorage` içindeki oturum/takım adıyla tekrar katılır.
- Eski tarayıcılarda `crypto.randomUUID` yoksa oturum kimliği için fallback var.
- Host ekranı bağlantı sonrasında güncel oyun durumunu açıkça ister.
- Hostta oyun/takım sıfırlama mevcut.

### Oyun akışı

- Oyun planı `config/game.json` dosyasından okunur.
- Varsayılan sıra:
  - 3 kelime turu × 60 saniye
  - 2 işlem turu × 90 saniye
- Host kontrolleri:
  - Tur başlat / bitir
  - Süre durdur / devam ettir
  - +15 saniye ekle
  - Kelime cevabını elle onayla / reddet
  - Oyunu sıfırla
- Toplam skorlar her turda korunur.
- Finalde ilk üç ekip gösterilir; CSV ve JSON sonuç indirme bağlantıları vardır.

### Kelime turu

- 8 harf + 1 joker.
- En az üç sesli; Türkçe frekans ağırlıklı üretim.
- `tr-TR` normalizasyonu kullanılır.
- Sözlük: `data/turkish-words.json`.
- Sözlükte olmayan fakat harflerden kurulabilen sözcükler host onayına düşer.
- Puan: harf sayısı; jokersiz 9 harfli kelimeye +5 bonus.

### İşlem turu

- 5 tek basamaklı sayı + 1 büyük sayı; 100–999 hedef.
- Dört işlem ve parantez desteklenir.
- `eval` kullanılmaz: `server/numberGame.ts` içindeki ayrıştırıcı kullanılır.
- Her sayı en fazla bir defa kullanılabilir; ara sonuçlar pozitif tam sayı olmalıdır.
- Puan: tam isabet 10, ±5 için 7, ±10 için 5.
- Sunucu tur başında olası en iyi çözümü hesaplar ve tur sonucu hostta gösterir.

### Tema

- PDF’deki NTT DATA marka değerleri ayrı dosyada: `src/theme.css`.
- Ana renkler:
  - Future Blue: `#0072BC`
  - Smart Navy: `#070F26`
  - Turquoise: `#00DFED`
- `src/styles.css` genel arka plan, panel, fokus ve hareket stillerini içerir.
- Henüz `/public/assets/logo.svg` için görünür logo/fallback bileşeni eklenmedi.

## Önemli dosyalar

- `server/index.ts`: Socket.IO olayları, oyun durum makinesi, config, dışa aktarma API’leri.
- `server/wordGame.ts`: kelime turu kuralları.
- `server/numberGame.ts`: işlem ayrıştırma, puanlama, solver.
- `config/game.json`: tur planı ve opsiyonel oyun ayarları.
- `src/pages/HostPage.tsx`: host/projeksiyon arayüzü.
- `src/pages/JoinPage.tsx`: mobil katılımcı arayüzü.
- `src/types.ts`: istemci oyun durum tipleri.
- `src/theme.css`: marka renkleri ve font önceliği.

## Doğrulananlar

- `npm run build` başarılı.
- İşlem motoru için elle çalıştırılan doğrulama senaryoları başarılı:
  - geçerli ifade
  - tekrar sayı reddi
  - puan seviyeleri
  - solver sonucu
- Önceki kelime kuralları ve Socket.IO tur ilerleme akışı da doğrulandı.

## Kalan işler

Kullanıcının son promptuna göre kalite/dokümantasyon maddeleri (yük testi, birim testleri, README) bilinçli olarak hariç bırakıldı. Bunlar dışındaki belirgin eksikler:

1. `public/assets/logo.svg` varsa gösteren, yoksa kurumsal metin/fallback gösteren logo bileşeni.
2. `config/game.json` içindeki `themedWord` ayarının harf üretimine gerçekten uygulanması (şu an yalnızca tur sonucu metni olarak gösteriliyor).
3. `predefinedTeams` ile mobilde takım seçimi.
4. `teamMode: "individual"` davranışının gerçek oyun mantığına bağlanması.
5. Ses efektlerini aç/kapat seçeneği.
6. Daha gelişmiş animasyonlu skor sırası ve daha güçlü konfeti/podyum görseli.
7. Host tur sonucunda en iyi kelimeyi/cevabı daha belirgin vurgulama.
8. İşlem turunda mobilde ara sonucu anlık hesaplama.

## Dikkat

- `stop-server.bat` ardından Vite penceresinde `/socket.io` için `ECONNREFUSED` görülmesi normaldir; `run-dev.bat` ile yeniden başlatılınca düzelir.
- `EADDRINUSE: 3000` hatası, eski bir sunucunun çalıştığını gösterir. Önce `stop-server.bat` çalıştırın.
- Kod değişikliğinden sonra açık geliştirme sunucusunu yeniden başlatmak ve tarayıcıda `Ctrl+F5` yapmak gerekebilir.
