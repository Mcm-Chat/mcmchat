# MCM — Panggilan Suara & Video (LiveKit)

Stack panggilan production-grade dengan **provider terpisah**. UI tidak pernah bergantung
pada SDK tertentu: seluruh media berjalan lewat `CallProvider`.

## Status kejujuran implementasi

| Bagian | Status |
| --- | --- |
| Sinyal (ringing / answer / decline / end / missed) di database + Realtime | **Selesai** |
| Endpoint token server-side (LiveKit JWT HS256, umur 15 menit) | **Selesai** |
| State machine panggilan + UI aktif (timer, mute, kamera, speaker, flip) | **Selesai** |
| Integrasi track audio hasil VoicePipeline ke sender | **Selesai** |
| Notifikasi panggilan masuk (channel `mcm_calls`) + deep link `/call/<id>` | **Selesai** |
| Kredensial LiveKit (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) | **Belum diisi** → UI menampilkan **Belum terhubung** |

Tidak ada panggilan simulasi. Selama secret belum diisi, `getCallConfig()` mengembalikan
`configured: false`, tidak ada mikrofon yang dibuka dan tidak ada koneksi yang dibuat.

## Arsitektur

```text
UI (call.$id.tsx, incoming-call.tsx)
        |
        v
useCall()  <-- state machine: loading → outgoing/incoming → connecting → connected → ended
        |                    (sinyal: tabel `calls` + Supabase Realtime)
        +--> issueCallToken()  (server fn, auth + cek peserta)  --> LiveKit JWT
        |
        +--> VoicePipeline (mic → efek premium) --> MediaStreamTrack
                                                        |
                                                        v
                                        CallProvider (LiveKit Room) --> SFU
```

File:

- `src/lib/calls/livekit.server.ts` — baca secret + mint JWT (Web Crypto, aman di Worker).
- `src/lib/calls/calls.functions.ts` — `getCallConfig`, `issueCallToken` (server fn).
- `src/lib/calls/provider.ts` — `CallProvider`, `liveKitProvider`, `unconfiguredProvider`.
- `src/lib/calls/use-call.ts` — state machine + integrasi VoicePipeline.
- `src/lib/api/calls.ts` — start/answer/decline/end/leave + langganan Realtime.
- `src/routes/call.$id.tsx` — layar panggilan aktif; jatuh ke detail riwayat bila selesai.
- `src/components/mcm/incoming-call.tsx` — panggilan masuk global (dipasang di `__root`).

## Keamanan

- API key/secret LiveKit **tidak pernah** ada di klien; token diterbitkan server dan hanya
  untuk peserta yang terdaftar pada baris `calls` (dicek lewat RLS).
- Token berumur 15 menit, terikat pada satu room, dan `canPublishSources` dibatasi
  ke mikrofon saja untuk panggilan suara.
- Panggilan yang sudah `ended`/`missed`/`declined` tidak pernah menerbitkan token baru.

## Voice Privacy

Track audio keluar diambil dari `VoicePipeline` saat entitlement premium aktif dan efek
dinyalakan. Ganti preset saat panggilan hanya memanggil `pipe.setParams()` — tanpa
renegosiasi, panggilan tidak drop. Mute mematikan **track sumber**, bukan gain pipeline.
Audio lawan bicara tidak pernah diproses.

## Mengaktifkan panggilan

Isi tiga secret di Project Settings → Secrets:

- `LIVEKIT_URL` (mis. `wss://<subdomain>.livekit.cloud`)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Setelah itu status "Belum terhubung" hilang dengan sendirinya, tanpa perubahan kode.
