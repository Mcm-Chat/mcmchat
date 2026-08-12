# Branding MCM — Preview vs Production

Aplikasi ini hanya menampilkan branding **MCM**. Tidak ada komponen, script, iframe,
atau overlay di dalam source proyek yang menampilkan badge/tombol "Edit with Lovable".

## Kenapa badge bisa terlihat di preview
URL preview editor (`*id-preview*.lovable.app`) dimuat di dalam environment editor.
Environment itu menyuntikkan skrip miliknya sendiri (badge "Edit with Lovable",
HMR bridge, hook pelaporan error) di luar bundle aplikasi. Skrip tersebut tidak
berasal dari `src/` dan tidak bisa dihapus dari kode proyek.

## Status build production
- Badge "Edit with Lovable" dinonaktifkan pada deploy publik (pengaturan publish
  `hide_badge = true`), sehingga situs production tidak memuatnya.
- Bundle production tidak berisi elemen UI berlabel Lovable.
- `src/lib/lovable-error-reporting.ts` hanya memanggil hook telemetri opsional
  (`window.__lovableEvents` / `window.__lovableReportRuntimeError`) yang hanya ada
  di dalam preview editor. Tidak ada UI, badge, atau teks yang dirender ke pengguna.
  Di production hook itu tidak ada, sehingga pemanggilan menjadi no-op.
- `@lovable.dev/vite-tanstack-config` adalah dependency build-time (konfigurasi Vite);
  tidak menyuntikkan branding ke halaman production.

## Verifikasi
```bash
rg -ni "lovable" src/   # hanya file telemetri internal, tanpa teks UI
```
Jika badge masih terlihat, pastikan yang dibuka adalah URL production
(`https://mcm-nexus-chat.lovable.app`) dan bukan URL preview editor.
