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
bunx cap init "MCM" app.mcm.privateconnect --web-dir=dist
bunx cap add android
```

`capacitor.config.ts` yang disarankan:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.mcm.privateconnect",
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
    applicationId "app.mcm.privateconnect"
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
