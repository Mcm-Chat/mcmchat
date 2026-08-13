# MCM — Matriks Kesiapan Produksi

Diaudit pada commit kerja 13 Agustus 2026. Status memakai empat nilai:
**WORKING** (berjalan penuh di produksi), **PARTIAL** (berjalan tetapi ada gap nyata),
**BLOCKED** (kode siap, tertahan kredensial/provider eksternal),
**NOT IMPLEMENTED** (belum ada).

## 1. Matriks modul

| Modul | Status | Catatan jujur |
| --- | --- | --- |
| Auth | WORKING | Supabase email/password + sesi; tidak ada anonymous sign-up. |
| PIN kontak | WORKING | PIN dibuat server-side; kolom PIN dicabut dari SELECT, akses hanya via RPC `SECURITY DEFINER`. |
| Chat realtime | WORKING | Realtime + pagination cursor + typing indicator + hapus pesan. |
| Receipts | WORKING | Sumber kebenaran `message_receipts`; RPC delivered/read; hormat setelan privasi. |
| Outbox offline | PARTIAL | Pesan teks persisten di IndexedDB per akun. **Lampiran belum ikut antrean persisten**. |
| Attachment/media | PARTIAL | Upload ke bucket privat + signed URL bercache per akun; belum ada progress/cancel/backoff/resume dan validasi magic-byte penuh. |
| Avatar | WORKING | Editor wajib, versi cache-busting, audiens privasi atomik lewat `set_avatar_privacy_audience`. |
| Status | WORKING | Bucket privat, `status_feed()` sadar privasi, viewer + reaksi + balasan ke chat. |
| Grup | PARTIAL | Percakapan grup + peran admin ada; undangan/link grup dan moderasi lanjutan belum. |
| Panggilan (LiveKit) | BLOCKED | Sinyal DB + token server-side selesai; tanpa `LIVEKIT_*` UI jujur "Belum terhubung", tidak ada mic dibuka. |
| Push Android (FCM) | BLOCKED | Registrasi device, action token, dispatch v1, inline reply, channel siap; butuh `google-services.json` + service account. |
| Katalog & stok | WORKING | Varian, konversi unit, saldo/mutasi inventaris, foto multi + lokasi per foto. |
| Penjualan | WORKING | `create_sale_tx` atomik + idempotency key server-side. |
| Penyiapan pegawai | WORKING | Job bertoken, foto+GPS wajib, update katalog/stok otomatis, kirim link via chat. |
| Ledger | PARTIAL | Utang/piutang + pembayaran sebagian + timeline; **belum ada lampiran bukti pada ledger induk, tanggal transaksi eksplisit, dan scheduler pengingat nyata**. |
| Peran bisnis | PARTIAL | RLS per peran (owner/admin/agent/cashier/viewer) berjalan; pemilihan bisnis aktif kini eksplisit per akun (tidak lagi diam-diam bisnis pertama), tetapi UI switcher penuh belum ada di semua layar. |
| Hapus akun | PARTIAL | `/delete-account` publik + `deleteMyAccount` menghapus user Auth (cascade FK). **Belum ada aturan transfer kepemilikan bisnis, pembersihan objek Storage eksplisit, dan audit event idempoten**. |
| Privasi/keamanan | PARTIAL | Kolom PIN pelanggan kini tidak terbaca staf mana pun (hanya RPC). RLS deny-by-default, bucket privat, `search_path` terkunci, EXECUTE dicabut dari PUBLIC. CSP masih memakai `unsafe-inline`/`unsafe-eval`. |
| Rilis Android | PARTIAL | compileSdk/targetSdk 36, AGP 8.9.1, FLAG_SECURE, workflow signed AAB + gate assetlinks. **Belum pernah ada AAB yang benar-benar dibangun/ditandatangani.** |
| Domain `mcmchat.id` | BLOCKED | Probe 13 Agustus 2026: NS masih `nsid1..4.rumahweb.*`, apex tidak resolve, HTTPS gagal (curl `000`). Detail di `DOMAIN_DNS_QA.md`. |
| Observability | NOT IMPLEMENTED | Belum ada telemetry privacy-safe/health page internal. Tidak ada konektor eksternal ditambahkan. |
| Billing premium | NOT IMPLEMENTED | Entitlement dibaca server-side dari tabel `entitlements`, tetapi **tidak ada provider billing tersambung** → status `not_configured`; tidak ada pembayaran palsu. |

## 2. Temuan awal audit ini

1. **README.md kontradiktif** — masih menyebut "seluruh data MVP tersimpan di localStorage", "Mode Demo", dan "panggilan simulasi" padahal stack sudah Supabase + LiveKit. (Critical: klaim palsu ke pengguna/reviewer.)
2. **targetSdk 35** — di bawah kewajiban Google Play (API 36) untuk pengajuan setelah 31 Agustus 2026. (Critical rilis.)
3. **AGP 8.7.2 / Kotlin 1.9.25** tidak kompatibel dengan compileSdk 36.
4. **assetlinks.json placeholder tanpa gate** — rilis bisa lolos dengan fingerprint palsu sehingga App Links diam-diam gagal. (High.)
5. **Script build tidak jujur/eksplisit** — tidak ada `build:web`, `android:sync`, `android:bundle`, atau verifikasi rilis.
6. **`myBusiness()` diam-diam memakai `.limit(1)`** — pengguna dengan >1 bisnis bisa bekerja pada bisnis yang salah. (High data-integrity.)
7. **Domain belum resolve** — bukan masalah kode; NS masih di Rumahweb.
8. **Kolom `customers.pin` terbaca semua anggota bisnis** termasuk peran `viewer`. (High privacy — sudah ditutup pada audit ini.)
9. **`message_hides` DELETE tidak memeriksa keanggotaan percakapan.** (Low — sudah ditutup.)
10. **`bun run lint` merah dengan 3.516 error format** sehingga gate CI tidak pernah benar-benar hijau. (High CI-integrity — sudah ditutup.)

## 3. Perubahan file pada audit ini

| File | Perubahan |
| --- | --- |
| `README.md` | Ditulis ulang: status nyata per modul, daftar kebutuhan pihak ketiga, daftar klaim yang **tidak** dibuat (E2EE, "tidak dapat dilacak", screenshot terblokir di web). |
| `PRODUCTION_READINESS.md` | Baru — dokumen ini. |
| `ANDROID_RELEASE.md` | SDK 36/AGP 8.9.1, prosedur fingerprint Play App Signing vs upload key, bagian verifikasi rilis. |
| `android/variables.gradle` | `compileSdkVersion`/`targetSdkVersion` → 36. |
| `android/build.gradle` | AGP 8.9.1, Kotlin 2.0.21. |
| `scripts/verify-assetlinks.mjs` | Baru — gate fingerprint (dan penulisan dari `MCM_ASSETLINKS_SHA256`). |
| `scripts/verify-aab.mjs` | Baru — verifikasi manifest AAB; SKIP jujur bila bundletool/AAB tidak ada. |
| `package.json` | Script jujur: `build:web`, `verify:assetlinks`, `verify:aab`, `android:sync`, `android:bundle`, `android:debug-apk`. |
| `.github/workflows/ci.yml` | Job `android-static` (SDK 36 + format assetlinks) dan laporan ukuran bundle. |
| `.github/workflows/android-release.yml` | Gate assetlinks sebelum build; verifikasi manifest AAB setelah build; memakai `build:web`. |
| `src/lib/api/business.ts` | `listMyBusinesses`, `getActiveBusinessId`/`setActiveBusinessId` per akun; `myBusiness` menghormati pilihan eksplisit. |
| migrasi DB | Cabut `SELECT` kolom `customers.pin` dari `authenticated` (akses lewat `customer_pin()`); `message_hides` DELETE kini memeriksa keanggotaan percakapan. |
| seluruh `src/**` | `eslint --fix` format-only agar gate lint CI hijau (0 error). |
| `src/lib/security/__tests__/production-readiness.test.ts` | Baru — regresi: dokumentasi tidak berbohong, SDK 36, gate assetlinks, script build tidak menyentuh native, tidak ada `.limit(1)` bisnis. |

## 4. Hasil gate aktual

Diisi dari eksekusi nyata pada audit ini — lihat bagian bawah dokumen setelah setiap rilis.

| Gate | Hasil |
| --- | --- |
| `bun run typecheck` | **PASS** — `tsgo --noEmit`, 0 error. |
| `bun run test` (Vitest) | **PASS** — 155/155 test, 21 file (termasuk 5 regresi baru audit ini). |
| `bun run lint` | **PASS** — 0 error, 18 warning (react-refresh/exhaustive-deps, non-blocking). Sebelum audit ini: 3.516 error format; diperbaiki dengan `eslint --fix`. |
| `bun run build:web` | **PASS** — bundle produksi Nitro/Vite dibuat. Chunk terbesar: `livekit-client` 974 kB (209 kB gzip), router 644 kB (136 kB gzip) → kandidat lazy-load pada iterasi berikutnya. |
| `bun run verify:assetlinks` | **FAIL (disengaja)** — fingerprint masih `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`. |
| `bun run verify:aab` | **SKIP** — tidak ada AAB dan tidak ada `bundletool` di lingkungan ini. |
| Gradle `bundleRelease` | **SKIP** — Android SDK/Gradle tidak tersedia di lingkungan editor. |
| Probe domain `mcmchat.id` | **FAIL** — NS Rumahweb, tidak resolve, HTTPS `000`. |
| Security scanner | **PASS untuk temuan yang dapat ditutup** — 4 → 1 warning. Ditutup: PIN pelanggan (kolom `pin` dicabut dari `authenticated`, akses hanya lewat `customer_pin()`), hapus `message_hides` kini memeriksa keanggotaan percakapan, `device_action_rate` fail-closed terkonfirmasi. Tersisa 1 warning generik "signed-in users can execute SECURITY DEFINER function" — **memang disengaja**: seluruh akses PIN/peran/transaksi atomik MCM justru bertumpu pada RPC `SECURITY DEFINER` dengan `search_path` terkunci dan pemeriksaan otorisasi di dalam fungsi. |
| Load test 50 klien realtime | **SKIP** — memerlukan lingkungan uji terpisah + service role; tidak dijalankan terhadap data produksi. |

## 5. Blocker eksternal (hanya bisa diselesaikan pemilik akun)

1. **DNS**: pindahkan NS `mcmchat.id` dari Rumahweb ke Cloudflare (atau buat record di zona otoritatif Rumahweb), termasuk record verifikasi `_lovable`.
2. **Firebase**: buat project + `google-services.json` (secret base64) + service account FCM v1.
3. **LiveKit**: isi `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
4. **Play signing**: buat keystore rilis, daftarkan Play App Signing, isi fingerprint SHA-256 ke assetlinks lewat secret `PLAY_APP_SIGNING_SHA256`.
5. **Play Console**: akun developer, Data Safety, internal testers, unggah AAB.
6. **Billing**: pilih dan sambungkan provider (Play Billing/Stripe/Paddle) sebelum premium dapat dijual.

## 6. Yang belum dikerjakan pada audit ini (gap tersisa, jujur)

- Outbox lampiran (blob) persisten + progress/cancel/backoff.
- Lampiran bukti & tanggal transaksi pada ledger, scheduler pengingat.
- Aturan transfer kepemilikan bisnis pada penghapusan akun + pembersihan Storage eksplisit.
- Observability/health page dan telemetry berbasis consent.
- Pengetatan CSP (nonce/hash) menggantikan `unsafe-inline`/`unsafe-eval`.
- Uji tiga perangkat fisik/APK dan load test realtime terukur.
