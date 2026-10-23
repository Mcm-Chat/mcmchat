# Audit izin Data API TOKOLINK — 23 Oktober 2026

Sumber: `Mcm-Chat/mcmchat` pada commit
`a6a6a576fb29d8564a37cdccfcc989abdb313e9e`.
Perbandingan baseline dengan draft PR #2 (`bac665b17883faf75fee8003bbb7d821d05e67ac`)
tidak menemukan perubahan SQL/Supabase; audit migrasi ini juga berlaku untuk
riwayat migrasi pada PR tersebut. Produksi tidak diubah.

## Hasil

Seluruh **86 berkas migrasi** diperiksa: **60 CREATE TABLE** pada `public`,
masing-masing sudah memiliki GRANT eksplisit serta pengaktifan RLS pada migrasi
yang membuatnya. Satu tabel lama, `push_action_tokens`, kemudian dihapus;
hasil akhir adalah **59 tabel**, **1 sequence** (`pin_search_log_id_seq`), dan
**130 policy RLS**. Tidak ditemukan CREATE ulang tabel yang kehilangan GRANT.
`ALTER PUBLICATION ... DROP TABLE` hanya mengubah publikasi Realtime, bukan
menghapus atau membuat ulang tabel.

**Tidak diperlukan GRANT tabel tambahan untuk perubahan 30 Oktober pada sumber
TOKOLINK ini.** Menambahkan GRANT massal justru berisiko membatalkan pembatasan
kolom PIN dan tabel internal. Patch memperbaiki empat jalur aplikasi agar sesuai
izin yang sudah ada, menambah inisialisasi saldo nol secara atomik di database,
serta pemeriksaan regresi. Tidak ada hak akses tabel pengguna yang ditambahkan.
Hasil patch memiliki **87 berkas migrasi**, dengan jumlah tabel/sequence/policy
yang sama. Migrasi baru hanya memasang fungsi/trigger inisialisasi varian;
tidak mengisi ulang atau menimpa stok varian lama.

Aturan perubahan dikonfirmasi melalui email Supabase 20 Oktober dan
[pengumuman Supabase](https://github.com/orgs/supabase/discussions/45329).
[Dokumentasi pengamanan Data API](https://supabase.com/docs/guides/api/securing-your-api)
menjelaskan bahwa GRANT dan RLS merupakan lapisan yang berbeda. GRANT menentukan
operasi yang dapat dicoba peran; RLS membatasi baris yang boleh diakses.

## Bukti per tabel dan pemakaian aplikasi

- `security/data-api-grant-inventory.json`: semua tabel, migrasi pembuat,
  pengaktifan RLS, dan perintah ACL pada saat pembuatan.
- `security/data-api-role-manifest.json`: ACL tabel/kolom dan ekspresi lengkap
  policy pada akhir replay baseline, ditambah operasi aplikasi yang ditinjau.
- `security/data-api-usage-audit.json`: **201 rantai kueri** ke **53 tabel literal** (baseline: 202),
  **114 pemanggilan RPC**, lokasi sumber, serta kebutuhan akses tidak langsung.

Klien server yang membawa JWT pengguna (`context.supabase`) tetap menggunakan
peran `authenticated`. Lokasi kode di server tidak menjadi alasan memberikan
hak `service_role`. Tidak ditemukan pemakaian tabel `public` langsung oleh
klien anonim atau nama tabel `public` dinamis. Nama bucket Storage dinamis
terpisah dari audit GRANT tabel aplikasi.

| Bagian | Keputusan izin akhir yang harus dipertahankan |
|---|---|
| `customers` | SELECT `authenticated` hanya delapan kolom aman; `pin` ditolak. Migrasi `20260813092105` sudah mencabut SELECT tingkat tabel sebelum GRANT kolom; pencabutan kolom pada migrasi berikutnya bukan satu-satunya perlindungan. |
| `business_members` | SELECT kolom aman; `staff_pin` ditolak. Aksi pengelolaan anggota tetap tunduk pada RLS pemilik/admin. |
| `preparation_jobs` | SELECT kolom eksplisit; `delivered_pin` ditolak. Kueri `JOB_SELECT` dan item turunan tetap dapat dibaca sesuai RLS admin/pegawai yang ditugaskan. |
| `profiles`, `devices`, `background_action_log`, `device_action_rate`, `notification_actions`, `pin_search_log` | Tidak ada akses tabel/kolom langsung bagi `anon`/`authenticated`; gunakan RPC atau backend yang sesuai. |
| `contacts`, `contact_requests` | SELECT `authenticated` tetap tersedia dengan policy pemilik/pihak dalam permintaan; perubahan hubungan melalui RPC. |
| `conversation_members`, `business_conversations` | Penulisan langsung pengguna dicabut; fungsi SECURITY DEFINER memeriksa pihak/keanggotaan. |
| `status_feed()` | SECURITY INVOKER: tetap perlu SELECT `authenticated` pada `statuses`, `status_items`, `status_views`, dan `status_mutes`. Kebutuhan `status_mutes` tidak terlihat dari kueri browser yang hanya menulis. |
| `pin_search_log_id_seq` | Pengguna tidak memperoleh USAGE/SELECT/UPDATE; jalur internal menggunakan owner fungsi, backend memiliki izin eksplisit. Tidak diperlukan GRANT sequence global. |
| `service_role` | GRANT eksplisit sudah ada pada seluruh tabel. Banyak migrasi lama memakai ALL, termasuk hak non-DML; audit ini mempertahankan hak lama dan tidak menambahnya. Pengurangan hak tersebut memerlukan audit backend/operasional tersendiri. |

Tidak ada policy PERMISSIVE bagi `anon` atau PUBLIC pada tabel aplikasi akhir.
`preparation_jobs` masih memiliki GRANT SELECT kolom lama kepada `anon`; tanpa
policy RLS, peran tersebut tidak mendapat baris. GRANT itu tidak dibutuhkan oleh
alur aplikasi yang diamati. `token_hash` juga masih dipilih secara eksplisit
oleh `src/lib/api/tasks.ts` dan diizinkan kepada pengguna yang lolos RLS.
Ini dicatat sebagai pembatasan lama untuk peninjauan terpisah, bukan alasan
memberikan SELECT tingkat tabel. Publikasi Realtime memakai daftar kolom yang
tidak mencakup hash token atau PIN pengiriman.

## Perbaikan aplikasi tanpa memperluas GRANT

Audit operasi aplikasi menemukan empat jalur yang bertentangan dengan izin
eksplisit. Seluruh pemanggilan `upsert()` literal ditinjau; jalur pengaturan
status, reaksi status, dan catatan panggilan memang memiliki izin UPDATE.

| Lokasi | Sebelum | Perbaikan |
|---|---|---|
| `src/lib/api/catalog.ts`, pembuatan varian | `inventory_balances.upsert()` membutuhkan INSERT/UPDATE yang sengaja tidak diberikan | Hapus penulisan langsung. Trigger AFTER INSERT `product_variants` membuat saldo nol dalam transaksi yang sama. |
| `src/lib/api/call-history.ts`, `hideCalls()` | `call_log_hides.upsert()` meminta UPDATE | `ignoreDuplicates: true`: INSERT dengan ON CONFLICT DO NOTHING, mempertahankan waktu pertama. |
| `src/lib/api/status.ts`, `markStatusViewed()` | `status_views.upsert()` meminta UPDATE | ON CONFLICT DO NOTHING, mempertahankan waktu lihat pertama. |
| `src/lib/api/status.ts`, `setStatusMuted()` | `status_mutes.upsert()` meminta UPDATE | ON CONFLICT DO NOTHING pada `(user_id, muted_user_id)`, membisukan berulang tetap idempoten. |

Trigger `ensure_variant_inventory_balance()` memakai SECURITY DEFINER dengan
`search_path` kosong dan nama tabel berkualifikasi. Produk induk harus memiliki
`business_id` yang sama dengan varian; baris produk dikunci FOR SHARE selama
inisialisasi. INSERT varian tetap tunduk pada GRANT/RLS pengguna. Konflik saldo
memakai DO NOTHING sehingga tidak menimpa jumlah yang sudah ada. EXECUTE
fungsi trigger dicabut dari PUBLIC, `anon`, dan `authenticated`; tidak ada
argumen RPC yang bisa dipakai untuk menetapkan stok. Fungsi yang sama dipasang
di migrasi pembuat varian untuk reset/database baru, serta migrasi maju
`20261023000000_initialize_variant_inventory_balance.sql` untuk database lama.

Urutan rilis: tinjau dan terapkan migrasi maju pada lingkungan pengujian,
verifikasi inisialisasi varian serta akses antar-tenant, lalu rilis klien.
Klien baru bergantung pada trigger untuk membuat baris saldo nol. Jangan
merilis klien sebelum migrasi tersebut tersedia pada database sasaran.

## Verifikasi dan batasnya

Replay seluruh 86 migrasi asli dan 87 migrasi setelah patch berhasil pada PostgreSQL 18.6 melalui PGlite
0.5.11 dengan default GRANT tabel kosong, bootstrap minimal `auth`/`storage`,
dan pgcrypto. Ini menjalankan SQL dan pemeriksaan GRANT/RLS PostgreSQL asli;
bukan simulasi hasil berbasis pencarian teks. Lingkungan itu bukan layanan
Supabase lengkap, PostgREST, Auth, Storage, Realtime, atau GraphQL.

Jalankan pemeriksaan sumber tanpa koneksi database:

```bash
python3 scripts/audit-data-api-grants.py
```

Guard memeriksa CREATE TABLE tingkat atas, keputusan GRANT/REVOKE eksplisit dan
ENABLE RLS pada berkas yang sama, serta kecocokan inventaris yang ditinjau.
Pemeriksaan negatif menghapus GRANT/RLS dan menyisipkan GRANT palsu dalam string;
seluruh perubahan tersebut ditolak. Guard ini bukan pembuktian efektivitas RLS,
urutan perubahan ACL, atau analisis SQL dinamis. Bentuk CREATE TABLE AS/UNLOGGED
serta CREATE TABLE bersarang yang terdeteksi ditolak untuk peninjauan manual;
DDL yang dirangkai dari fragmen string tetap memerlukan peninjauan manusia.

Pada database pengujian/preview yang selesai menjalankan seluruh migrasi:

```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/data-api-grants.sql
```

Replay patch juga meluluskan **46 pemeriksaan GRANT/RLS nyata** dengan data sintetis, termasuk pengguna/tenant lain, penolakan PIN, saldo nol otomatis, penolakan produk induk bisnis lain, stok lama tetap utuh, serta tiga operasi INSERT berulang tanpa UPDATE.

Berkas SQL itu hanya membaca katalog dalam transaksi yang di-ROLLBACK;
memeriksa RLS seluruh tabel, DML backend, larangan PIN/tabel internal/sequence
untuk pengguna, serta dependensi SELECT `status_feed`. Jangan arahkan perintah
reset atau penerapan migrasi ke produksi. Validasi Data API nyata dengan JWT
dua pengguna tenant berbeda, kunci anonim dan backend hanya dilakukan pada
lingkungan pengujian yang identitas proyeknya telah dipastikan.

Uji PostgreSQL terisolasi dapat diulang tanpa pemasangan dependensi aplikasi:

```bash
npm ci --prefix scripts/data-api-tests --no-audit --no-fund
node scripts/data-api-tests/replay.mjs "$PWD" WORKTREE tokolink
```

Workflow `Data API migration grants` menjalankan guard sumber, replay seluruh
migrasi, dan pemeriksaan peran/RLS tanpa kredensial database. Keberhasilan lokal tidak menyatakan bahwa CI GitHub, Data API live,
atau database produksi sudah diverifikasi. Identitas proyek produksi aktif
belum dipastikan oleh audit repositori ini; tidak ada pengujian HTTP Data API
terautentikasi ke produksi.
