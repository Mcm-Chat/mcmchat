# MCM — Private Chat, Calls & Smart Ledger

Aplikasi mobile-first (TanStack Start + React + Tailwind + shadcn/ui) untuk chat berbasis PIN,
panggilan, catatan utang-piutang, dan fitur bisnis. Seluruh data MVP tersimpan di localStorage.

## Fitur nyata (berfungsi penuh di MVP)
- Splash, onboarding, login, registrasi + PIN otomatis, dan **Mode Demo** (status disimpan di localStorage).
- App shell mobile-first: header + bottom navigation (Chat, Panggilan, Catatan, Bisnis, Profil), light/dark mode, radius 16px.
- Identitas PIN: kartu PIN dengan salin + QR, tambah kontak lewat pencarian PIN (contoh `R8NA-K4Q7`), kirim/terima/tolak permintaan, blokir.
- Chat: daftar chat + grup "Tim MCM", pencarian, unread badge, pin/mute, arsip; ruang chat dengan kirim pesan, reply, reaksi, status terkirim/dibaca, lampiran, quick action, dan saran "Buat catatan bersama".
- Catatan utang-piutang: dashboard total piutang/utang/jatuh tempo/lunas, buat catatan baru dengan validasi, alur "Menunggu Persetujuan" → setuju/tolak, catat pembayaran sebagian, progress, timeline, ekspor CSV.
- Bisnis: KPI, katalog 8 produk dengan pencarian & filter kategori, detail + tambah/edit produk, 4 pesanan dengan invoice, quick replies (`/harga`, `/alamat`, `/jam`, `/rekening`, `/katalog`, `/statuspesanan`), team inbox (open/pending/closed + assignee), siaran.
- Profil & pengaturan: edit profil, PIN/QR, switch privasi/keamanan/notifikasi yang persist, perangkat aktif, dark mode, app lock, reset demo.
- Semua perubahan state persist ke localStorage; notifikasi memakai `sonner`.

## Fitur simulasi (belum production)
- Panggilan suara/video: layar panggilan bertimer dengan kontrol mute, kamera, speaker, flip, tambah peserta — **Simulasi MVP**, bukan WebRTC nyata.
- OTP registrasi memakai kode demo `123456`.
- Pemindai QR, siaran pelanggan, pembayaran/ongkir, app lock, dan sinkronisasi antar-perangkat masih simulasi lokal.
- Direktori pengguna hanya data demo di perangkat; pencarian PIN nyata memerlukan backend.

Privasi terlindungi sesuai pengaturan aplikasi. Aplikasi ini berjalan dalam **mode demo** dan tidak menjanjikan enkripsi ujung-ke-ujung produksi.
