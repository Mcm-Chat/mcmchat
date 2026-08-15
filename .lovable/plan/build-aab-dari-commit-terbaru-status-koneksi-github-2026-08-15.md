# Build AAB dari commit terbaru — status koneksi GitHub

## Temuan (terverifikasi)

- Remote git proyek ini hanya `origin` (storage internal Lovable) dan `secondary` (S3 internal). **Tidak ada remote GitHub** → proyek ini **belum terhubung ke GitHub**.
- Commit terbaru: `a4fa7e3 Pasang Firebase google-services`.
- Workflow rilis sudah siap: `.github/workflows/android-release.yml` (`workflow_dispatch`, build `bundleRelease`, guard `verify:identity` / `verify:assetlinks` / `verify:aab`, artifact `mcm-release-aab`).

## Blocker

Menyambungkan/mengekspor proyek ke GitHub **tidak bisa dilakukan agent**. Git Sync adalah aksi OAuth di UI Lovable (butuh otorisasi akun GitHub Anda). Tidak ada kode yang perlu diubah.

## Tindakan UI yang harus Anda lakukan (persis satu alur)

1. Buka halaman editor proyek ini: https://lovable.dev/projects/9cf45269-2526-4d6e-838d-94af7e8b75d7
2. Di kolom chat kiri bawah, klik tombol **+** → **GitHub** → **Connect project**.
3. Otorisasi Lovable GitHub App, pilih akun **ace08081988-arch**.
4. Di field nama repo isi persis: `mcmchat` (repo baru). **Jangan** pilih repo `MCM` atau `mcmstorage` yang sudah ada.
5. Klik **Create Repository**.

Setelah repo jadi, isi Secrets repo di https://github.com/ace08081988-arch/mcmchat/settings/secrets/actions :
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_APP_SIGNING_SHA256`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
`GOOGLE_SERVICES_JSON_BASE64` opsional (file klien Firebase sudah persisten di repo).

Lalu jalankan build: https://github.com/ace08081988-arch/mcmchat/actions/workflows/android-release.yml → **Run workflow** → unduh artifact `mcm-release-aab`.

## Setelah Anda konfirmasi repo terhubung

Saya akan (tanpa mengubah fitur/UI):
- Verifikasi remote GitHub muncul dan commit terbaru ikut ter-push.
- Cek daftar secret mana yang masih kosong berdasarkan kebutuhan workflow.
- Pantau run Actions dan laporkan link run + SHA + hasil tiap step; kalau gagal karena kode/config workflow, saya perbaiki; kalau gagal karena kredensial, saya sebut persis apa yang harus Anda isi.
