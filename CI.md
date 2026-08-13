# CI MCM — Gate Keamanan Database

Workflow: `.github/workflows/ci.yml`

Berjalan otomatis pada **setiap pull request**, setiap push ke `main`/`production`, dan pada merge queue.

| Job | Isi | Wajib |
| --- | --- | --- |
| `db-security-regression` | `bun run test:security` — invariant PIN, izin bucket `avatars`, hapus anggota jalur admin, keanggotaan percakapan, privasi avatar & blokir | ya |
| `quality` | typecheck (`tsgo`), lint, seluruh test (`vitest run`), build produksi | ya |
| `dependency-audit` | `bun audit --audit-level=high` | ya |
| `production-gate` | hanya untuk PR yang menuju branch `production`; menunggu ketiga job di atas | ya |

## Menjadikannya blocking sebelum merge
Langkah ini hanya dapat dilakukan pemilik repositori:

1. GitHub → Settings → Branches → Add branch ruleset untuk `main` dan `production`.
2. Aktifkan **Require a pull request before merging** dan **Require status checks to pass**.
3. Pilih status check: `Regresi keamanan database`, `Typecheck, test, build`, `Audit dependensi`,
   dan `Gate sebelum merge ke production` (khusus ruleset `production`).
4. Aktifkan **Require branches to be up to date** dan (opsional) **Merge queue**.

## Secret yang dibutuhkan
`VITE_SUPABASE_URL` dan `VITE_SUPABASE_PUBLISHABLE_KEY` (nilai publishable, bukan rahasia server).
Job keamanan DB tidak memerlukan secret apa pun — ia menganalisis file migrasi dan kode sumber secara statis.
