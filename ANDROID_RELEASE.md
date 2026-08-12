# MCM — Panduan Rilis Android (Play Store)

MCM adalah aplikasi web mobile-first (PWA) yang dibungkus menjadi aplikasi Android.
Dokumen ini adalah langkah rilis yang harus dijalankan di komputer lokal Anda
(Android Studio + JDK 17 diperlukan; proses build Android tidak bisa dijalankan di editor Lovable).

## 1. Ekspor & siapkan proyek

1. Klik **GitHub → Export to GitHub** di Lovable, lalu `git clone` repositori tersebut.
2. `bun install` (atau `npm install`).
3. `bun run build` untuk memastikan build produksi lolos.

## 2. Bungkus dengan Capacitor

```bash
bun add @capacitor/core @capacitor/cli @capacitor/android
bunx cap init "MCM" com.mcm.privateconnect --web-dir=dist
bunx cap add android
```

`capacitor.config.ts` yang disarankan:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mcm.privateconnect",
  appName: "MCM",
  webDir: "dist",
  server: {
    // Aplikasi memakai backend nyata; arahkan ke URL produksi yang sudah dipublikasikan.
    url: "https://mcm-nexus-chat.lovable.app",
    cleartext: false,
  },
  android: { backgroundColor: "#0f1b2a" },
};

export default config;
```

Setelah setiap perubahan web: `bun run build && bunx cap sync android`.

## 3. Izin Android

Tambahkan pada `android/app/src/main/AndroidManifest.xml` hanya izin yang benar-benar dipakai:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Setiap izin harus dijelaskan pada listing Play Store:
kamera dan lokasi untuk foto produk/penyiapan bertanda lokasi, mikrofon untuk pesan suara,
notifikasi untuk pesan masuk.

## 4. Ikon, splash, dan tema

- Ikon sumber: `public/icon-512.png` (512×512, maskable).
- Buat ikon adaptif melalui Android Studio → **Image Asset**.
- Warna latar/splash: `#0f1b2a` (sama dengan `theme_color` pada `public/manifest.webmanifest`).

## 5. Versi & penandatanganan

Pada `android/app/build.gradle`:

```gradle
defaultConfig {
    applicationId "com.mcm.privateconnect"
    minSdkVersion 23
    targetSdkVersion 35
    versionCode 1
    versionName "1.0.0"
}
```

Buat keystore rilis dan simpan di luar repositori:

```bash
keytool -genkey -v -keystore mcm-release.keystore -alias mcm -keyalg RSA -keysize 2048 -validity 10000
```

Isi `android/keystore.properties` (jangan di-commit) lalu rujuk pada `signingConfigs.release`.

## 6. Build App Bundle

```bash
bunx cap sync android
cd android && ./gradlew bundleRelease
# hasil: android/app/build/outputs/bundle/release/app-release.aab
```

## 7. Checklist Play Console

- [ ] Nama aplikasi: **MCM — Private Chat, Calls & Smart Ledger**
- [ ] Deskripsi singkat & panjang (bahasa Indonesia + Inggris)
- [ ] Tangkapan layar telepon (min. 2, 1080×1920): Chat, Tugas, Katalog, Keuangan, Profil
- [ ] Ikon 512×512 dan feature graphic 1024×500
- [ ] URL Kebijakan Privasi: `https://mcm-nexus-chat.lovable.app/privacy`
- [ ] URL Syarat Layanan: `https://mcm-nexus-chat.lovable.app/terms`
- [ ] URL Penghapusan Akun: `https://mcm-nexus-chat.lovable.app/delete-account`
- [ ] Formulir **Data safety**: data yang dikumpulkan = email, nama, foto, pesan, lokasi (opsional), data bisnis; dienkripsi saat transit; pengguna dapat meminta penghapusan
- [ ] Rating konten: aplikasi komunikasi, usia minimum 13 tahun
- [ ] Target API level 35 (Android 15)
- [ ] Uji internal (internal testing) sebelum produksi

## 8. Catatan fitur

- **Panggilan suara/video** belum aktif karena kredensial penyedia panggilan belum dikonfigurasi.
  Riwayat panggilan tetap tersimpan, dan UI menampilkan status "belum dikonfigurasi" secara jujur.
  Jangan mencantumkan panggilan sebagai fitur aktif pada listing sampai kredensial ditambahkan.
- **Notifikasi push** memerlukan Firebase Cloud Messaging (`google-services.json`) dan kredensial
  server. Sampai itu tersedia, aplikasi hanya menampilkan notifikasi di dalam aplikasi.

---

## Notifikasi Android interaktif (produksi)

### 1. Paket native yang dibutuhkan

```bash
npm i @capacitor/push-notifications @capacitor/app @capacitor/camera \
      @capacitor/geolocation @capacitor-community/secure-storage-plugin
npx cap sync android
```

Seluruh plugin dimuat dinamis oleh `src/lib/push/native.ts`, jadi build web
tetap jalan walau paket di atas belum terpasang.

### 2. Kredensial FCM di server

Tambahkan secret di **Project Settings → Secrets**:

| Secret | Isi |
| --- | --- |
| `FCM_SERVICE_ACCOUNT_JSON` | isi file service account Firebase (JSON penuh) |

Tanpa secret ini `getPushStatus()` mengembalikan `configured: false`, aplikasi
tetap berjalan normal dan halaman **Izin & Notifikasi** menampilkan status
"belum dikonfigurasi". Setelah menambah/mengubah secret, publish ulang agar
versi produksi memakainya.

Letakkan `google-services.json` di `android/app/`.

### 3. Channel notifikasi

Channel dibuat otomatis saat registrasi (`ensureChannels`), sesuai
`src/lib/push/payload.ts`:

| Channel | ID | Importance |
| --- | --- | --- |
| Pesan | `mcm_messages` | High |
| Panggilan | `mcm_calls` | Max |
| Tugas Penyiapan | `mcm_tasks` | High |
| Penjualan & Pesanan | `mcm_sales` | Default |
| Hutang & Pembayaran | `mcm_ledger` | Default |
| Umum | `mcm_general` | Low |

### 4. Aksi latar belakang (balas & tandai dibaca)

Receiver native memanggil endpoint publik:

```
POST https://project--<project-id>.lovable.app/api/public/push/actions
{ "action": "reply" | "read" | "delivered", "token": "<action token>", "conversationId": "...", "body": "...", "idempotencyKey": "..." }
```

- `token` adalah kredensial **device-scoped** hasil `register_push_device`;
  hanya SHA-256-nya tersimpan di server dan token disimpan di Keystore /
  EncryptedSharedPreferences melalui secure storage plugin.
- Setiap aksi memakai `idempotencyKey` sehingga retry FCM tidak menggandakan balasan.
- Logout memanggil `revoke_my_push_devices` → token push dan kredensial aksi dicabut.

### 5. Deep link

Payload push membawa `route` (mis. `/chat/<id>?m=<messageId>`), dipetakan oleh
`routeFromPush()` dengan fallback aman bila record sudah dihapus.

### 6. Izin

Halaman **Profil → Izin & notifikasi** menampilkan status runtime untuk
notifikasi, kamera, mikrofon, lokasi, dan foto, lengkap dengan tombol minta izin
dan pintasan ke Setelan Android saat izin ditolak permanen. MCM tidak memakai
background location, `MANAGE_EXTERNAL_STORAGE`, maupun exact alarm — sesuai
kebijakan Play Store.

## Tiga kapabilitas push yang TERPISAH

Jangan menyamakan ketiganya. Layar **Izin & Notifikasi** menampilkannya satu per satu
supaya aplikasi tidak mengklaim kemampuan yang belum ada.

1. **Server pengirim push (FCM) dikonfigurasi** — kredensial FCM v1 tersedia di server.
2. **Token perangkat terdaftar** — perangkat ini punya baris di tabel `devices`
   dengan izin notifikasi yang sudah diberikan pengguna.
3. **Penerima latar native terpasang** — APK menyertakan `FirebaseMessagingService`
   MCM yang menangani data-only message saat proses aplikasi dimatikan, membangun
   notifikasi, channel, PendingIntent deep-link, serta aksi **Balas** dan
   **Tandai dibaca** yang memanggil `/api/public/push/actions`.

Repo ini belum memuat sumber Android native (folder `android/` dibuat oleh
`npx cap add android` di luar Lovable), jadi kapabilitas (3) **belum terbukti**.
Selama receiver native belum terpasang, pengiriman saat aplikasi benar-benar
ditutup tidak dijamin dan UI tidak boleh menjanjikannya.

### Kontrak penanda receiver

Setelah `FirebaseMessagingService` MCM terpasang, wadah Android wajib menandai
dirinya sedini mungkin di WebView:

```java
webView.evaluateJavascript(
  "window.MCMNative = Object.assign(window.MCMNative || {}, { backgroundReceiver: true });",
  null);
```

Tanpa penanda ini aplikasi tetap melaporkan "Belum" pada baris ketiga.

### Izin notifikasi bersifat opt-in kontekstual

Aplikasi tidak pernah memunculkan dialog izin hanya karena pengguna membuka
halaman. Registrasi otomatis hanya terjadi bila izin sudah diberikan sebelumnya;
selain itu pengguna menekan sendiri **Aktifkan notifikasi di perangkat ini** di
layar Izin & Notifikasi.

## Proteksi screenshot & perekaman layar

Pemblokiran screenshot/perekaman **hanya** berasal dari `FLAG_SECURE` di
`MainActivity` APK (plus `setRecentsScreenshotEnabled(false)` pada API 33+).
Tidak ada setelan web/PWA yang bisa memblokir screenshot OS, dan aplikasi tidak
boleh mengklaimnya. Detail file native, perilaku, dan langkah verifikasi ada di
`ANDROID_SCREEN_SECURITY.md`.
