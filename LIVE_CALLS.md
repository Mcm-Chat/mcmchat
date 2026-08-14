# Panggilan Suara & Video MCM

## Status jujur

**Status: code-ready, BELUM diverifikasi end-to-end.** Seluruh jalur panggilan
(state machine, RPC, token, media, diagnostik) sudah ditulis dan diuji lewat
unit test + verifikasi ACL/definisi fungsi di database, **tetapi belum pernah
dijalankan pada panggilan nyata** karena kredensial penyedia belum diisi.
Predikat "production-ready" baru boleh dipakai setelah:

1. `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` terisi; dan
2. uji dua perangkat nyata (audio dan video, jawab/tolak/batal/timeout) berhasil.

Tanpa kredensial, aplikasi menolak membuat panggilan sejak awal (tidak ada baris
`ringing` hantu dan tidak ada notifikasi ke penerima).

Secret yang wajib diisi di Project Settings → Secrets:

- `LIVEKIT_URL` (contoh `wss://<subdomain>.livekit.cloud`)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Secret hanya dibaca di server; klien hanya menerima token berumur pendek (15 menit).

## Alur status

1. Pemanggil membuat panggilan → status `ringing`. Pemanggil **belum** masuk room.
2. Penerima menjawab → `answer_call` mengubah status jadi `ongoing`.
3. Setelah status `ongoing`, kedua sisi memanggil `join_call` lalu meminta token.
   `join_call` dan `issueCallToken` **menolak status `ringing`** — tidak ada sisi
   yang bisa masuk room sebelum panggilan dijawab.
4. Menutup panggilan memakai `leave_call`: pada 1:1 panggilan langsung berakhir;
   pada grup, panggilan hanya berakhir bila pemanggil keluar atau tidak ada peserta aktif.
5. Alasan akhir dibedakan tegas dan divalidasi server (kode resmi saja):
   - 45 detik tanpa jawaban → `missed` / `timeout`
   - pemanggil menutup sebelum dijawab → `ended` / `cancelled`
   - penerima menolak → `declined` / `declined`
   - menutup saat berlangsung → `ended` / `hangup`
6. Dering kedaluwarsa dihitung absolut dari `created_at`, sehingga membuka ulang
   layar tidak memperpanjang waktu dering.

Semua transisi status dilakukan lewat RPC `SECURITY DEFINER`; klien tidak punya
izin `INSERT/UPDATE/DELETE` langsung pada tabel `calls` dan `call_participants`.
ACL RPC panggilan (`join_call`, `leave_call`, `answer_call`, `end_call`,
`create_call_tx`, `expire_stale_calls`) hanya `authenticated` + `service_role`;
`anon`/`PUBLIC` sudah dicabut.

## Diagnostik

Halaman **Profil → Diagnostik panggilan** (`/settings/calls`) memeriksa:
penyedia panggilan, konteks HTTPS, dukungan `mediaDevices`, izin mikrofon dan
kamera, tes membuka perangkat secara nyata, serta **Tes koneksi LiveKit**
end-to-end: server menerbitkan token untuk room diagnostik acak dengan TTL
60 detik dan grant `canPublish=false`, `canSubscribe=false`,
`canPublishData=false`; klien menyambung, mengukur latensi sampai `connected`,
lalu memutus pada `finally`. Tes tidak menyentuh baris panggilan mana pun dan
tombolnya nonaktif bila kredensial belum ada (`provider_unconfigured`).
`LIVEKIT_URL` juga divalidasi harus `wss://` — tiga string terisi saja tidak
membuat `configured=true`. Setiap kegagalan disertai kode aman + langkah
perbaikan dalam Bahasa Indonesia.

## Catatan perangkat

- Layar tetap menyala selama panggilan aktif (Wake Lock). Event `release` dari
  sistem ditangani: wake lock diambil ulang hanya saat halaman terlihat dan
  panggilan masih aktif, tanpa acquire ganda, dan dilepas bersih saat selesai.
- Bila browser memblokir autoplay, tombol **Aktifkan suara** muncul di layar panggilan.
- Putus koneksi tak terduga ditandai sebagai error yang bisa dicoba ulang, sedangkan
  penutupan normal tidak memunculkan pesan error.
## Yang masih memerlukan langkah manual

- Mengisi `LIVEKIT_URL` (wss://), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- Uji dua perangkat nyata: audio, video, jawab, tolak, batal sebelum dijawab,
  timeout 45 detik, keluar peserta grup vs pemanggil grup.
- Verifikasi App Link `/call` pada perangkat Android (butuh `assetlinks.json`
  ter-publish untuk `mcmchat.id` dan `www.mcmchat.id`).
