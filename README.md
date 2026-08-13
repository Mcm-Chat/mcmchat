# MCM — Private Chat, Calls & Smart Ledger

Aplikasi bisnis mobile-first (TanStack Start + React + Tailwind + shadcn/ui) dengan backend
Supabase (Postgres + RLS + Realtime + Storage) dan pembungkus Android (Capacitor).

> Status kejujuran: **bukan MVP localStorage lagi**. Seluruh data utama tersimpan di database
> dengan RLS. Beberapa modul masih **BLOCKED** karena membutuhkan kredensial/provider eksternal
> (Firebase, LiveKit, DNS, Play Console, billing). Matriks lengkap: [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).

## Modul nyata (berjalan di atas database)
- **Auth & PIN**: registrasi/login Supabase, PIN MCM dibuat server-side; pencarian PIN hanya lewat RPC `SECURITY DEFINER`.
- **Kontak**: permintaan kontak, terima/tolak (`respond_contact_request`), blokir dua arah (`blocked_between`).
- **Chat realtime**: pesan, reply, reaksi, lampiran, lokasi, pagination cursor, indikator mengetik, hapus pesan.
- **Receipts**: sumber kebenaran `message_receipts` + RPC `mark_messages_delivered` / `mark_messages_read`, menghormati privasi read receipt.
- **Outbox offline**: antrean pesan **teks** persisten di IndexedDB per akun (lampiran belum persisten — lihat matriks).
- **Status**: bucket privat, `status_feed()` sadar privasi, viewer full-screen, balasan status ke chat.
- **Katalog & stok**: produk, varian, konversi unit, saldo & mutasi inventaris, foto produk multi + lokasi per foto.
- **Penjualan & keuangan**: `create_sale_tx` atomik, catatan utang/piutang, pembayaran sebagian, ekspor.
- **Penyiapan pegawai**: job bertoken, foto + GPS wajib, pembaruan katalog & stok otomatis, kirim link lewat chat.
- **Panggilan**: sinyal panggilan di database + token LiveKit server-side (butuh secret, lihat di bawah).
- **Privasi layar**: `FLAG_SECURE` **hanya pada APK Android native**; di browser/PWA hanya tirai privasi saat blur.

## Yang membutuhkan pihak ketiga (belum aktif di lingkungan ini)
| Kebutuhan | Efek bila belum diisi |
| --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Layar panggilan menampilkan **Belum terhubung**; tidak ada mikrofon dibuka |
| `google-services.json` + service account FCM v1 | Push Android tidak terkirim; UI melaporkan status apa adanya |
| Fingerprint Play App Signing | `bun run verify:assetlinks` gagal; App Links belum terverifikasi |
| DNS `mcmchat.id` (NS masih Rumahweb) | Domain produksi belum resolve; lihat `DOMAIN_DNS_QA.md` |
| Provider billing (Play Billing/Stripe) | Entitlement premium `not_configured`; tidak ada pembayaran palsu |

## Tidak diklaim
- **Bukan** end-to-end encrypted. Enkripsi in-transit (TLS) dan at-rest oleh penyedia database, bukan E2EE.
- **Bukan** "tidak dapat dilacak".
- Screenshot **tidak** terblokir di browser/PWA.
- Belum ada AAB rilis yang benar-benar dibangun & ditandatangani di lingkungan ini.

## Script
| Perintah | Arti sebenarnya |
| --- | --- |
| `bun run dev` | dev server Vite |
| `bun run build:web` (alias `build`) | bundle produksi TanStack/Nitro/Vite |
| `bun run typecheck` | `tsgo --noEmit` |
| `bun run test` / `test:security` | seluruh Vitest / hanya invariant keamanan |
| `bun run lint` | ESLint |
| `bun run verify:assetlinks` | gagal bila fingerprint App Links masih placeholder |
| `bun run android:sync` / `android:bundle` / `android:debug-apk` | Capacitor sync, AAB rilis, APK debug |
| `bun run verify:aab` | cek manifest bundle (SKIP jujur bila bundletool/AAB tidak ada) |

Dokumen terkait: `PRODUCTION_READINESS.md`, `ANDROID_RELEASE.md`, `LIVE_CALLS.md`,
`ANDROID_SCREEN_SECURITY.md`, `DOMAIN_DNS_QA.md`, `CI.md`, `PREMIUM_VOICE_EFFECTS.md`.
