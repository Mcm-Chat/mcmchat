# Panggilan Suara & Video MCM

## Status jujur

Seluruh jalur panggilan (state machine, RPC, token, media) sudah production-ready,
**tetapi panggilan tidak akan berjalan sampai kredensial penyedia diisi**. Tanpa
kredensial, aplikasi menolak membuat panggilan sejak awal (tidak ada baris
`ringing` hantu dan tidak ada notifikasi ke penerima).

Secret yang wajib diisi di Project Settings → Secrets:

- `LIVEKIT_URL` (contoh `wss://<subdomain>.livekit.cloud`)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Secret hanya dibaca di server; klien hanya menerima token berumur pendek (15 menit).

## Alur status

1. Pemanggil membuat panggilan → status `ringing`. Pemanggil **belum** masuk room.
2. Penerima menjawab → `answer_call` mengubah status jadi `ongoing`.
3. Kedua sisi memanggil `join_call` (idempotent) lalu meminta token dan masuk room.
4. Menutup panggilan memakai `leave_call`: pada 1:1 panggilan langsung berakhir;
   pada grup, panggilan hanya berakhir bila pemanggil keluar atau tidak ada peserta aktif.
5. Dering kedaluwarsa dihitung absolut dari `created_at`, sehingga membuka ulang
   layar tidak memperpanjang waktu dering.

Semua transisi status dilakukan lewat RPC `SECURITY DEFINER`; klien tidak punya
izin `INSERT/UPDATE/DELETE` langsung pada tabel `calls` dan `call_participants`.

## Diagnostik

Halaman **Profil → Diagnostik panggilan** (`/settings/calls`) memeriksa:
penyedia panggilan, konteks HTTPS, dukungan `mediaDevices`, izin mikrofon dan
kamera, serta tes membuka perangkat secara nyata. Setiap kegagalan disertai
langkah perbaikan dalam Bahasa Indonesia.

## Catatan perangkat

- Layar tetap menyala selama panggilan aktif (Wake Lock, diabaikan bila tidak didukung).
- Bila browser memblokir autoplay, tombol **Aktifkan suara** muncul di layar panggilan.
- Putus koneksi tak terduga ditandai sebagai error yang bisa dicoba ulang, sedangkan
  penutupan normal tidak memunculkan pesan error.