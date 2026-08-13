# DOMAIN / DNS / HTTPS QA — mcmchat.id

Audit dijalankan langsung terhadap resolver publik dan server otoritatif
(Google DNS 8.8.8.8 via DoH, Cloudflare 1.1.1.1 via DoH, dan
`nsid1.rumahweb.com` sebagai otoritatif), 13 Agustus 2026 ± 07:45 UTC.

## 0. Ringkasan eksekutif — BLOCKER UTAMA

**`mcmchat.id` sama sekali tidak resolve. Domain BELUM Live dan sertifikat
belum bisa diterbitkan.**

Penyebab akar: **nameserver domain masih di Rumahweb, bukan Cloudflare.**

```
mcmchat.id NS -> nsid1.rumahweb.com, nsid2.rumahweb.net,
                 nsid3.rumahweb.biz, nsid4.rumahweb.org   (TTL 21600)
```

Record A `185.158.133.1` dan TXT `_lovable` yang dibuat lewat Entri/Cloudflare
masuk ke **zona Cloudflare yang tidak otoritatif**, jadi tidak pernah terlihat
publik. Query langsung ke zona otoritatif Rumahweb mengembalikan **kosong**
untuk A, AAAA, CAA, `www`, dan `_lovable` TXT. Karena itu Lovable menampilkan
"Action required" pada kedua entri domain.

Tidak ada satu pun perubahan di sisi aplikasi yang bisa memperbaiki ini —
harus dikerjakan pemilik domain (lihat §7).

## 1. DNS aktual (PASS/FAIL)

| Record | Diminta | Terlihat publik | TTL | Status |
|---|---|---|---|---|
| `mcmchat.id` A | `185.158.133.1` | **tidak ada** (NXRRSET, hanya SOA) | – | **FAIL** |
| `mcmchat.id` AAAA | tidak perlu | tidak ada | – | PASS (benar kosong) |
| `mcmchat.id` NS | `norah.ns.cloudflare.com`, `remy.ns.cloudflare.com` | `nsid1-4.rumahweb.*` | 21600 | **FAIL** |
| `_lovable` TXT | `lovable_verify=…` | **tidak ada** | – | **FAIL** |
| `www` A/CNAME | apex/redirect | **tidak ada** | – | **FAIL** |
| `mcmchat.id` MX | – | `10 mx1.titan.email`, `20 mx2.titan.email` | 14400 | PASS (Titan aktif) |
| `mcmchat.id` TXT SPF | – | `v=spf1 include:spf.titan.email ~all` | 14400 | PASS |
| `_dmarc` TXT | direkomendasikan | **tidak ada** | – | PENDING |
| `mcmchat.id` CAA | opsional | tidak ada | – | PASS (tidak memblokir Let's Encrypt) |
| DNSSEC (DS di `.id`) | – | tidak ada DS | – | PASS (tidak menghambat) |

Perbedaan resolver: **tidak ada**. Google, Cloudflare, dan otoritatif Rumahweb
konsisten — SOA `2026081300`, zona benar-benar tanpa A record. Ini bukan
masalah propagasi/TTL; record-nya memang belum ada di zona yang dipakai.

Catatan penting: MX + SPF Titan berada di zona **Rumahweb**. Jika nanti NS
dipindah ke Cloudflare, MX dan SPF ini **wajib disalin dulu** ke Cloudflare,
kalau tidak email bisnis Titan langsung mati.

## 2. HTTP / HTTPS / TLS

| Endpoint | Hasil |
|---|---|
| `http://mcmchat.id` | **FAIL** — `Could not resolve host` |
| `https://mcmchat.id` | **FAIL** — `Could not resolve host` |
| `http://www.mcmchat.id` | **FAIL** — tidak resolve |
| `https://www.mcmchat.id` | **FAIL** — tidak resolve |
| TLS handshake apex | **FAIL** — tidak ada alamat; belum ada sertifikat/SAN/expiry |
| `https://mcmchat.lovable.app` | **PASS** — HTTP 200, aplikasi MCM tampil benar |

HSTS/mixed content pada domain kustom: **PENDING** sampai domain resolve.
Header sudah disiapkan di aplikasi (lihat §5) dan aktif di build produksi.

## 3. Status custom domain di Lovable

Query URL proyek mengembalikan **tidak ada custom domain terhubung**
(hanya preview + `https://mcmchat.lovable.app`). Dua entri "Action required"
yang pernah muncul tidak pernah tervalidasi, karena TXT `_lovable` tidak
pernah terlihat publik.

Tooling agent tidak dapat menambah/menghapus koneksi domain — langkah ini
manual di **Project Settings → Domains** (lihat §7). Target akhir: **satu**
koneksi apex `mcmchat.id` (+ opsional `www.mcmchat.id`), duplikat dihapus.

## 4. Cloudflare proxy

Selama verifikasi dan penerbitan sertifikat, **wajib DNS only (awan abu-abu)**.
Setelah domain berstatus Active, proxy oranye didukung Lovable **hanya** bila
domain dikoneksikan dengan opsi *"Domain uses Cloudflare or a similar proxy"*
(mode verifikasi berbasis CNAME). Untuk MCM — yang memakai WebSocket Supabase
Realtime dan LiveKit — **rekomendasi: tetap DNS only**. Itu menghindari lapisan
TLS ganda, batas idle WebSocket Cloudflare, dan atribusi region edge yang
membingungkan pada pemindai cookie.

## 5. Perubahan aplikasi yang sudah dikerjakan (commit ini)

- `src/lib/site.ts` — satu sumber kebenaran `SITE_URL = https://mcmchat.id`
  (override `VITE_SITE_URL`), helper `canonical()` untuk canonical + og:url +
  og:image/twitter:image absolut.
- Canonical + og:url ditambahkan ke route publik: `/`, `/login`, `/register`,
  `/privacy`, `/terms`, `/delete-account`, `/download`, `/support`.
- `public/sitemap.xml` — baru, seluruh URL memakai `https://mcmchat.id`.
  `<lastmod>` sengaja **tidak** dipakai (tidak ada timestamp per-halaman yang
  otoritatif; nilai berbasis waktu build akan menyesatkan).
- `public/robots.txt` — menambahkan `Sitemap:` dan melarang crawl route privat
  (`/chat`, `/status`, `/tasks`, `/ledger`, `/finance`, `/catalog`, `/business`,
  `/calls`, `/call`, `/contacts`, `/profile`, `/prepare`, `/photo`, `/settings`,
  `/api/`).
- `public/manifest.webmanifest` — `id`, `scope: "/"`, `start_url: "/"`,
  `orientation`, ikon `any` dan `maskable` dipisah (relatif, jadi otomatis
  benar di domain mana pun).
- `src/lib/http-security.ts` + `src/server.ts` — redirect kanonis
  `www.mcmchat.id` → `https://mcmchat.id` (301, tanpa loop) dan header keamanan
  pada semua respons: CSP (HTML), HSTS 1 tahun + includeSubDomains,
  `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`,
  `frame-ancestors 'self'` / `X-Frame-Options`, `upgrade-insecure-requests`.
  CSP mengizinkan `connect-src https: wss:` agar Supabase Realtime, LiveKit,
  dan FCM tidak putus; `blob:`/`media-src` dibuka untuk kamera, rekaman suara,
  dan worklet voice privacy.
- `public/.well-known/assetlinks.json` sudah memakai package
  `com.mcm.privateconnect`; **PENDING** hanya fingerprint SHA-256 Play App
  Signing (masih placeholder — hanya pemilik akun Play Console yang punya).
- `capacitor.config.ts` sudah membaca `MCM_APP_URL` dengan default
  `https://mcmchat.id`. **Sampai domain Live, build APK/AAB wajib memakai
  `MCM_APP_URL=https://mcmchat.lovable.app`.**

Tidak ada referensi Lovable/preview pada UI publik.

## 6. Verifikasi setelah perubahan

| Gate | Hasil |
|---|---|
| `tsgo --noEmit` | PASS (bersih) |
| `bun run test` | PASS — 136/136, 19 file |
| `bun run build` | PASS |
| Smoke route publik | PASS — `/`, `/login`, `/register`, `/privacy`, `/terms`, `/delete-account`, `/download`, `/support` = 200 |
| Deep link unauthenticated | PASS — `/chat/abc`, `/status` = 200, tidak crash, tidak membocorkan data |
| Canonical terlihat di HTML | PASS — `<link rel="canonical" href="https://mcmchat.id/privacy">` |
| Header keamanan terkirim | PASS — CSP, HSTS, Referrer-Policy, Permissions-Policy, nosniff |
| Konsol browser (390×844) | PASS — nol pelanggaran CSP / error konsol |
| Smoke domain publik | **FAIL/PENDING** — domain belum resolve |

## 7. Tindakan pemilik yang masih dibutuhkan (tanpa password/OTP)

**Nameserver Cloudflare yang ditetapkan untuk zona ini:**

```
norah.ns.cloudflare.com
remy.ns.cloudflare.com
```

Probe ulang 13 Agustus 2026 ± 10:00 UTC: NS publik **masih**
`nsid1-4.rumahweb.*` (TTL 21600), A dan `_lovable` TXT masih kosong. Jadi
peralihan ke Cloudflare **belum** terjadi di registrar.

Pilih **satu** jalur.

### Jalur B — pindah NS ke Cloudflare (jalur yang dipilih)
1. Di dashboard Cloudflare zona `mcmchat.id`, **salin dulu** record email yang
   sekarang hidup di Rumahweb, kalau tidak email Titan mati saat NS berpindah:
   - `MX` `@` → `mx1.titan.email` prioritas 10
   - `MX` `@` → `mx2.titan.email` prioritas 20
   - `TXT` `@` → `v=spf1 include:spf.titan.email ~all`
2. Tambahkan record aplikasi, semuanya **DNS only (awan abu-abu)**:
   - `A` `@` → `185.158.133.1`
   - `A` `www` → `185.158.133.1`
   - `TXT` `_lovable` → nilai `lovable_verify=…` persis dari dialog Lovable
     (ambil ulang; jangan pakai nilai lama dari Entri).
3. Di registrar `.id` (PANDI via Rumahweb), ubah nameserver menjadi **tepat
   dua** entri berikut dan hapus keempat NS Rumahweb:
   - `norah.ns.cloudflare.com`
   - `remy.ns.cloudflare.com`
4. Tunggu delegasi berubah (biasanya 15 menit–4 jam; TTL NS lama 21600 detik /
   6 jam). Verifikasi: `dig NS mcmchat.id +short` mengembalikan kedua NS
   Cloudflare, lalu `dig A mcmchat.id +short` mengembalikan `185.158.133.1`.
5. Di Lovable: **Project Settings → Domains** → hapus kedua entri
   "Action required" → **Connect Domain** → `mcmchat.id` → salin TXT yang
   ditampilkan → **Connect Domain** lagi untuk `www.mcmchat.id` → tetapkan
   `mcmchat.id` sebagai **Primary**.
6. Tunggu status Verifying → Setting up → **Active**, lalu Publish.

Sampai status Active, biarkan semua record **DNS only**. Proxy oranye baru
boleh dipertimbangkan setelah sertifikat terbit — dan untuk MCM tetap
**tidak disarankan** (lihat §4).

### Jalur A — cadangan: tetap kelola DNS di Rumahweb
1. Masuk ke panel DNS Rumahweb untuk `mcmchat.id`.
2. Tambah record:
   - `A` — nama `@` — nilai `185.158.133.1` — TTL 3600
   - `A` — nama `www` — nilai `185.158.133.1` — TTL 3600
   - `TXT` — nama `_lovable` — nilai persis `lovable_verify=…` yang ditampilkan
     Lovable saat menghubungkan domain (jangan pakai nilai lama dari Entri;
     ambil ulang dari dialog Lovable).
3. **Jangan sentuh** MX Titan dan TXT SPF yang sudah ada.
4. Di Lovable: **Project Settings → Domains** → hapus kedua entri
   "Action required" → **Connect Domain** → `mcmchat.id` → salin TXT yang
   ditampilkan → lalu **Connect Domain** lagi untuk `www.mcmchat.id` →
   tetapkan `mcmchat.id` sebagai **Primary** (Lovable akan meredirect `www`;
   redirect 301 di aplikasi menjadi lapisan cadangan).
5. Tunggu status berubah Verifying → Setting up → **Active**, lalu Publish.

Jalur A hanya dipakai bila peralihan NS ke Cloudflare dibatalkan. Jangan
jalankan Jalur A dan B setengah-setengah: setelah NS pindah ke Cloudflare,
panel Rumahweb tidak lagi otoritatif dan perubahan di sana tidak berefek.

## 8. Keamanan email domain

Titan Email **sudah aktif** (MX + SPF terpasang). Karena itu:

- **JANGAN** memasang `v=spf1 -all`. Itu akan menolak seluruh email keluar
  Titan. Rekomendasi awal `-all` dalam checklist hanya berlaku untuk domain
  yang benar-benar tidak mengirim email — bukan kasus ini.
- SPF saat ini (`~all`) sudah benar. Ketatkan ke `-all` **hanya** setelah semua
  pengirim sah terdaftar: `v=spf1 include:spf.titan.email -all`.
- **DMARC belum ada** — tambahkan bertahap, jangan langsung `p=reject`:
  1. `_dmarc` TXT → `v=DMARC1; p=none; rua=mailto:admin@mcmchat.id; fo=1`
  2. Pantau ±2 minggu, pastikan DKIM Titan lolos.
  3. Naikkan ke `p=quarantine`, lalu `p=reject`.
- **DKIM Titan** belum terlihat di zona. Aktifkan dari panel Titan dan pasang
  record CNAME/TXT yang diberikan sebelum menaikkan DMARC.
- MX palsu **tidak** dibuat.

## 9. Sisa PENDING

| Item | Blocker |
|---|---|
| DNS A/TXT `_lovable` publik | Pemilik domain (§7) |
| Lovable domain Active + duplikat dihapus | Pemilik, UI Project Settings |
| Sertifikat TLS/SAN/HSTS di apex | Otomatis setelah DNS benar |
| `assetlinks.json` SHA-256 | Play Console App Signing |
| DKIM + DMARC | Panel Titan + DNS |
