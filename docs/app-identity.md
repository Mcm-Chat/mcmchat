# Identitas Aplikasi — MCM: Private Connect

Repo ini membangun **satu** aplikasi: aplikasi chat privat MCM. Tidak ada
aplikasi kedua, tidak ada flavor, tidak ada artifact turunan.

| Aspek | Nilai |
| --- | --- |
| Nama produk | MCM: Private Connect |
| applicationId | `com.mcm.privateconnect` |
| Domain | `mcmchat.id`, `mcmchat.lovable.app` |
| Firebase client | project Firebase khusus chat (`google-services.json` disuntik dari secret CI) |
| Notification channels | `mcm_messages`, `mcm_calls`, `mcm_calls_ongoing`, `mcm_tasks`, `mcm_sales`, `mcm_ledger`, `mcm_general` |
| Signing key | keystore rilis khusus chat (`ANDROID_KEYSTORE_BASE64`) |
| Versioning | `versionCode`/`versionName` di `android/app/build.gradle`, independen |
| Workflow rilis | `.github/workflows/android-release.yml` (AAB chat saja) |
| Privacy policy & Play listing | listing terpisah untuk aplikasi chat |

## Pemisahan dari MCM STORAGE

MCM STORAGE adalah produk dan project yang **berbeda**. Di repo ini berlaku:

- Dilarang memakai atau menghasilkan package `mcmstorage.app` / `biz.mcmstorage.app`.
- Dilarang membangun, menandatangani, atau mengunggah artifact MCM Storage.
- Dilarang menulis ke project/data/deployment MCM STORAGE `b29d53bc-658a-4d86-8c6c-32fdd495b32b`.
- Tidak ada asumsi "satu build menghasilkan MCM Storage + chat" — satu build = satu AAB chat.

Pekerjaan MCM Storage dan unggahan Play-nya hanya dilakukan di project MCM STORAGE.

## Penegakan otomatis

- `bun run verify:identity` (`scripts/verify-app-identity.mjs`) memindai seluruh repo:
  gagal bila ada string MCM Storage, applicationId ganda, `applicationIdSuffix`, atau `productFlavors`.
- `bun run verify:aab` memeriksa manifest bundle hasil rilis: hanya `com.mcm.privateconnect`,
  tanpa package lain dan tanpa branding MCM Storage.
- `src/lib/security/__tests__/apk-separation.test.ts` menjadikan invariant ini bagian dari suite tes.
- Workflow rilis menjalankan `verify:identity` sebelum build dan `verify:aab` setelah build.
