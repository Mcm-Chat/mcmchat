# MCM — Proteksi Screenshot & Perekaman Layar

## Ringkasan jujur

| Lingkungan | Screenshot OS | Perekaman layar | Recent Apps | Cetak |
| --- | --- | --- | --- | --- |
| APK Android (`FLAG_SECURE`) | Diblokir OS | Diblokir OS | Kosong/dimatikan | – |
| Browser & PWA | **Tidak bisa diblokir** | **Tidak bisa diblokir** | Ditutup privacy curtain | Diblokir CSS print |

JavaScript tidak pernah bisa memblokir screenshot sistem operasi. Klaim
sebaliknya adalah keamanan palsu, jadi MCM tidak menampilkannya.

## File native

- `android/app/src/main/java/com/mcm/privateconnect/MainActivity.kt`
  - `FLAG_SECURE` dipasang **sebelum** `super.onCreate` (tidak ada jeda konten terlihat),
    lalu ditegakkan ulang pada `onResume` dan `onWindowFocusChanged`.
  - `setRecentsScreenshotEnabled(false)` pada API 33+ (guard `Build.VERSION.SDK_INT`).
  - Menandai kapabilitas ke WebView: `window.MCMNative.screenSecurity = { flagSecure, recentsScreenshotDisabled }`.
  - Tidak ada toggle pengguna; fail-closed. Tidak ada isi layar/chat/token yang di-log.
- `android/app/src/main/AndroidManifest.xml` — `MainActivity` `singleTask`, `configChanges`
  lengkap sehingga rotation tidak me-recreate activity; `allowBackup=false`.
- `android/app/src/main/res/values/strings.xml` — nama aplikasi `MCM`, package `com.mcm.privateconnect`.
- `capacitor.config.ts` — appId `com.mcm.privateconnect`, URL dari `MCM_APP_URL`
  (default `https://mcmchat.id`; selama domain belum Live pakai
  `MCM_APP_URL=https://mcmchat.lovable.app`).

Folder Gradle penuh (wrapper, `build.gradle`, `variables.gradle`, resource ikon)
dihasilkan oleh `npx cap add android`. File di atas sengaja ditulis agar
**tidak tertimpa**: setelah `cap add android`, salin/pertahankan `MainActivity.kt`
dan blok `<activity>` di manifest.

## Lapisan web (bukan pengganti)

- `src/components/mcm/screen-privacy-guard.tsx` — privacy curtain berlogo MCM saat
  `visibilitychange`, `blur`, atau `pagehide`; dilepas hanya setelah frame pertama siap.
- `src/lib/security/screen-privacy.ts` — pemetaan kapabilitas + reducer tirai (diuji unit).
- `@media print` di `src/styles.css` — halaman cetak hanya berisi
  "Konten MCM dilindungi — pencetakan dinonaktifkan."
- Tidak ada deteksi screenshot palsu, tidak memblokir klik kanan, copy/paste chat tetap jalan.

## Verifikasi nyata

1. `npx cap add android && MCM_APP_URL=... npx cap sync android`.
2. Jalankan APK, coba tombol Power+Volume Down → Android menampilkan
   "Tidak dapat mengambil screenshot karena kebijakan aplikasi".
3. Mulai screen recording → hasil rekaman hitam di area MCM.
4. Tekan Recent Apps → kartu MCM tidak menampilkan konten.
5. Uji setelah rotation, buka via deep link push, terima panggilan masuk, dan
   kembali dari background — semuanya tetap terblokir.
6. Preview browser **tetap bisa** di-screenshot: itu perilaku yang diharapkan dan
   bukan bukti kegagalan proteksi APK.
