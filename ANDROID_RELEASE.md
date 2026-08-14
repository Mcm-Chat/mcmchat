# MCM — Panduan Rilis Android (Play Store)

Paket final: **`com.mcm.privateconnect`** · Nama aplikasi: **MCM** · Domain produksi: **https://mcmchat.id**

> Catatan jujur: JDK dan Android SDK **tidak tersedia** di lingkungan editor, jadi APK/AAB belum pernah dibangun di sini.
> Yang sudah dipastikan di repo: dependency Capacitor terdeklarasi (`@capacitor/core`, `@capacitor/cli`,
> `@capacitor/android` v7.6.8), `bunx cap sync android` berjalan sukses, dan file generated
> (`android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`,
> `android/capacitor-cordova-android-plugins/`) plus Gradle wrapper resmi
> (`android/gradlew`, `gradlew.bat`, `gradle/wrapper/*`, Gradle 8.11.1) ada di repo.

## 0. Versi toolchain (exact, tanpa versi dinamis)
| Komponen | Versi |
| --- | --- |
| Capacitor (core/cli/android) | 7.6.8 |
| Android Gradle Plugin | 8.9.1 |
| Gradle wrapper | 8.11.1 |
| JDK | 21 (Temurin) |
| Kotlin | 2.0.21 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 23 |

## 1. Ekspor & prasyarat
1. GitHub → Export to GitHub, lalu `git clone`.
2. `bun install --frozen-lockfile` && `bun run build:web` (harus lolos).
3. JDK 21 + Android SDK 36 (Android Studio / `sdkmanager "platforms;android-36" "build-tools;36.0.0"`).

## 2. Capacitor
```bash
bunx cap sync android     # JANGAN `cap add android` — akan menimpa kustomisasi MCM
```
`capacitor.config.ts` memakai appId `com.mcm.privateconnect`, appName `MCM`, `webDir: capacitor/www`
(fallback offline; UI nyata dimuat dari `server.url` HTTPS produksi).
File di `android/` pada repo ini menimpa hasil scaffold Capacitor — jangan hapus:

| Berkas | Isi |
| --- | --- |
| `android/variables.gradle` | `mcmVersionCode` / `mcmVersionName` terpusat + compileSdk/targetSdk **36** |
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
1. `public/.well-known/assetlinks.json` masih berisi placeholder. Isi dengan fingerprint SHA-256
   **Play App Signing key** (Play Console → Setup → App signing → "App signing key certificate"),
   bukan upload key — upload key hanya dipakai untuk menandatangani AAB yang diunggah.
   Cara aman: `MCM_ASSETLINKS_SHA256=AB:CD:... bun run verify:assetlinks` (menulis + memvalidasi format).
   Workflow rilis memanggil gate yang sama dan **membatalkan build** bila fingerprint masih placeholder.
2. Publish web ke domain `mcmchat.id`, pastikan `https://mcmchat.id/.well-known/assetlinks.json` dapat diakses publik.
3. Verifikasi: `adb shell pm verify-app-links --re-verify com.mcm.privateconnect`.
Path yang ditangani: `/chat`, `/status`, `/tasks`, `/prepare`, `/ledger`, `/delete-account`.

## 6b. Verifikasi rilis
- `bun run verify:assetlinks` — gagal bila fingerprint palsu/format salah.
- `bun run verify:aab` — memeriksa package, targetSdk 36, deep link, dan POST_NOTIFICATIONS pada AAB
  (SKIP jujur bila `bundletool`/AAB belum ada).
- Workflow `android-release.yml` juga dapat membuat APK debug internal (`bun run android:debug-apk`).

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
