# Status integrasi GitHub — MCM: Private Connect

## Temuan (terverifikasi barusan)

- Remote git proyek ini hanya dua, keduanya internal Lovable:
  - `origin` → penyimpanan git internal Lovable (project `9cf45269-2526-4d6e-838d-94af7e8b75d7`)
  - `secondary` → mirror S3 internal
- **Tidak ada remote GitHub sama sekali.** Jadi proyek ini **belum tersambung** ke `ace08081988-arch/mcmchat` maupun repo GitHub lain.
- Commit terbaru di branch kerja: `d64bd30 Aktifkan prefers-reduced-motion`.
- Tidak ada jejak `mcmstorage` di repo ini (guard `verify:identity` + tes `apk-separation` menegakkannya), jadi risiko menyentuh repo MCM Storage nol dari sisi kode.

## Bisakah saya membuat/menyambungkan repo itu langsung?

**Tidak.** Git Sync adalah aksi OAuth di UI Lovable yang butuh otorisasi akun GitHub Anda. Agent tidak punya izin membuat repo atau menyambungkan project. Tidak ada kode yang perlu diubah untuk ini.

## Langkah yang harus Anda lakukan (di HP juga bisa)

1. Buka editor proyek ini di Lovable.
2. Di kolom chat, tombol **+** → **GitHub** → **Connect project**.
3. Otorisasi Lovable GitHub App, pilih akun **ace08081988-arch**.
4. Isi nama repo persis: `mcmchat` (repo baru). **Jangan** pilih `mcmstorage` atau `MCM` yang sudah ada.
5. Klik **Create Repository**.

## Setelah Anda konfirmasi repo tersambung

Saya akan (tanpa mengubah fitur/UI):
- Verifikasi remote GitHub muncul dan commit terbaru ikut ter-push.
- Cek secret repo yang masih kosong untuk `.github/workflows/android-release.yml` (`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`; `GOOGLE_SERVICES_JSON_BASE64` opsional karena file klien Firebase sudah ada di repo).
- Pantau run Actions dan laporkan link run + SHA + hasil tiap step.
