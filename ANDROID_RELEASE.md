# MCM — Panduan Rilis Android (Play Store)

Paket final: **`com.mcm.privateconnect`** · Nama aplikasi: **MCM** · Domain produksi: **https://mcmchat.id**

> Catatan jujur: Android SDK/Gradle **tidak tersedia** di lingkungan editor, jadi APK/AAB belum pernah dibangun di sini.
> Seluruh sumber, konfigurasi Gradle, manifest, resource, dan workflow signed AAB sudah lengkap dan siap dibuild di
> mesin lokal atau GitHub Actions.

## 1. Ekspor & prasyarat
1. GitHub → Export to GitHub, lalu `git clone`.
2. `bun install` && `bun run build` (harus lolos).
3. JDK 17 + Android Studio (SDK 35).

## 2. Capacitor
```bash
bun add @capacitor/core @capacitor/cli @capacitor/android
bunx cap add android      # hanya jika folder android/ belum lengkap
bunx cap sync android
```
`capacitor.config.ts` sudah memakai appId `com.mcm.privateconnect`, appName `MCM`, dan `server.url` produksi HTTPS.
File di `android/` pada repo ini menimpa hasil scaffold Capacitor — jangan hapus:

| Berkas | Isi |
| --- | --- |
| `android/variables.gradle` | `mcmVersionCode` / `mcmVersionName` terpusat + versi SDK |
| `android/app/build.gradle` | release AAB, R8/minify, signing dari environment |
| `android/app/proguard-rules.pro` | keep rules Capacitor, FCM, LiveKit/WebRTC |
| `android/app/src/main/AndroidManifest.xml` | izin minimum, App Links, FileProvider, kanal notifikasi |
| `res/xml/network_security_config.xml` | HTTPS-only, cleartext dimatikan |
| `res/values/styles.xml` + `mipmap-anydpi-v26` | tema MCM, splash, adaptive + monochrome icon |
| `MainActivity.kt` | `FLAG_SECURE` fail-closed + proteksi Recent Apps |

## 3. Izin & audit komponen
Hanya: INTERNET, POST_NOTIFICATIONS, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, ACCESS_FINE/COARSE_LOCATION
(hanya saat dipakai), FOREGROUND_SERVICE(+MICROPHONE untuk panggilan).
**Tidak ada** background location dan **tidak ada** MANAGE_EXTERNAL_STORAGE.
Satu-satunya komponen `exported` adalah `MainActivity`; FileProvider `exported=false`.
Pemilihan foto memakai Android Photo Picker modern bila tersedia, fallback ke input file web.

## 4. FCM
1. Buat project Firebase, tambahkan app Android `com.mcm.privateconnect`.
2. Unduh `google-services.json` → simpan sebagai secret base64 `GOOGLE_SERVICES_JSON_BASE64` (jangan commit).
3. Service account FCM v1 disimpan sebagai secret backend (sudah dipakai server function push MCM).

## 5. LiveKit
Isi secret `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` di Project Settings → Secrets.
Tanpa secret, layar panggilan tampil "Belum terhubung" (bukan mock).

## 6. App Links (mcmchat.id)
1. `public/.well-known/assetlinks.json` sudah ada; ganti `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`
   dengan fingerprint SHA-256 dari Play Console → Setup → App signing.
2. Publish web ke domain `mcmchat.id`, pastikan `https://mcmchat.id/.well-known/assetlinks.json` dapat diakses publik.
3. Verifikasi: `adb shell pm verify-app-links --re-verify com.mcm.privateconnect`.
Path yang ditangani: `/chat`, `/status`, `/tasks`, `/prepare`, `/ledger`, `/delete-account`.

## 7. Build & signing
Lokal:
```bash
export MCM_KEYSTORE_PATH=/path/mcm-release.jks
export MCM_KEYSTORE_PASSWORD=... MCM_KEY_ALIAS=... MCM_KEY_PASSWORD=...
cd android && ./gradlew clean bundleRelease   # output: app/build/outputs/bundle/release/*.aab
```
CI: workflow `.github/workflows/android-release.yml` (workflow_dispatch) membaca secret
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`,
`GOOGLE_SERVICES_JSON_BASE64`. Keystore/password tidak pernah masuk repo dan dihapus dari runner setelah build.

## 8. Uji internal
- Play Console → Testing → Internal testing, unggah AAB, tambah tester.
- Cek: login, chat realtime + receipts, Status, panggilan LiveKit, notifikasi interaktif (balas/tandai dibaca),
  penyiapan pegawai via QR, foto profil (editor → "Pasang foto profil"), FLAG_SECURE (screenshot harus gagal).

## 9. Halaman wajib Play Store
`/privacy`, `/terms`, `/delete-account`, `/download` — semuanya dapat dibuka tanpa login dengan branding MCM.

## 10. Langkah yang hanya bisa dilakukan pemilik akun
Membuat keystore rilis, akun Play Console, project Firebase, secret LiveKit, pengaturan DNS `mcmchat.id`,
dan pengisian fingerprint assetlinks.
