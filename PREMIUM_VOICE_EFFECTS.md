# MCM Premium — Voice Privacy (Efek Suara Panggilan)

Fitur premium untuk mengubah **karakter suara pengguna sendiri** secara real-time saat
voice call dan video call. Tujuannya privasi, kenyamanan, dan aksesibilitas — **bukan**
penyamaran identitas.

## Status kejujuran implementasi

| Bagian | Status |
| --- | --- |
| Preset + parameter + gating + penyimpanan preferensi | **Selesai, bekerja end-to-end** |
| Pipeline Web Audio (AudioWorklet) + tes mikrofon live | **Selesai, bekerja end-to-end di WebView/browser** |
| Entitlement premium (tabel `entitlements`, RPC `has_entitlement`) | **Selesai**, tetapi **penagihan belum tersambung** — tidak ada baris aktif, jadi semua pengguna non-premium |
| Penyedia panggilan (LiveKit/WebRTC/SFU) | **Arsitektur & integrasi selesai** (lihat `LIVE_CALLS.md`); track efek sudah tersambung ke sender. Menunggu kredensial `LIVEKIT_*` — sampai itu UI menampilkan "Belum terhubung". |
| Native Android audio path (panggilan saat app di background) | **Belum** — lihat "Integrasi berikutnya" |

Artinya: efek suara sudah nyata dan bisa didengar lewat **Tes mikrofon**, tetapi belum ada
media panggilan nyata untuk dilewati sampai provider call dipasang.

## Arsitektur

```text
getUserMedia (AEC + NS + AGC perangkat ON)
        |
        v
MediaStreamSource
        |
        v
AudioWorklet "mcm-voice-privacy"   <- pitch, formant, noise gate, denoise, karakter
        |
        v
BiquadFilter lowshelf/highshelf/peaking   <- tone / EQ, karakter radio
        |
        +--> dry --------------------+
        |                            v
        +--> delay+feedback -> wet -> outGain -> Analyser (meter)
                                             -> MediaStreamDestination
                                                    |
                                                    v
                                        track audio untuk sender WebRTC
```

File:

- `public/worklets/mcm-voice-privacy.js` — AudioWorkletProcessor (audio thread).
- `src/lib/voice/presets.ts` — tipe, preset, batas parameter, intensitas, normalisasi.
- `src/lib/voice/pipeline.ts` — `VoicePipeline`: attach/setParams/setBypass/dispose + state.
- `src/lib/voice/use-voice-preview.ts` — hook tes mikrofon (tanpa perekaman).
- `src/lib/api/entitlements.ts` — abstraksi entitlement premium.
- `src/lib/api/settings.ts` — `voiceOf()` + patch `voice` pada `user_settings`.
- `src/components/mcm/voice-effects.tsx` — panel + bottom sheet + badge indikator.
- `src/routes/settings.voice.tsx` — Pengaturan > Panggilan > Efek Suara Premium.
- `src/routes/premium.tsx` — halaman manfaat Premium + status langganan.
- `src/routes/call.$id.tsx` — tombol **Efek Suara** di layar panggilan + indikator aktif.

## Preset

`Nonaktif`, `Natural+`, `Deep`, `Bright`, `Warm`, `Robot ringan`, `Radio / Walkie Talkie`,
`Anonymous / Privacy`, `Custom`.

Custom mengekspos: pitch (±5 semitone), formant, tone/EQ, noise gate (dB), peredam derau
latar, gain keluaran (±12 dB), reverb ringan. Rentang sengaja dibatasi (`LIMITS`) supaya
suara tetap terdengar wajar dan tidak bisa dijadikan alat penyamaran identitas.

## Batasan latency & perangkat

- Grain worklet 1024 sampel ≈ **21 ms @48 kHz**, ditambah `AudioContext.baseLatency`.
  Total tambahan tipikal **25–40 ms** — di bawah ambang percakapan yang terasa.
- Kompleksitas O(n) per frame, tanpa FFT, agar aman untuk perangkat kelas bawah.
- Fallback otomatis (tanpa memutus panggilan):
  - `AudioWorklet` tidak tersedia → status `bypass`, suara normal, info singkat di UI.
  - `onprocessorerror` / gagal `addModule` → status `failed`, `setBypass(true)`.
  - `AudioContext` tidak ada → stream asli dikembalikan apa adanya.
- AEC/NS/AGC bawaan tetap ON di `MIC_CONSTRAINTS`; efek dipasang **setelah** tahap itu.

## Feature flag & entitlement

- Fitur: `voice_effects` (`FEATURE_VOICE_EFFECTS`).
- Sumber kebenaran: tabel `entitlements` + `has_entitlement(_user_id, _feature)`.
  Hanya service role yang boleh menulis; klien tidak bisa memberi dirinya premium.
- Non-premium: melihat entry point, memilih preset, dan **pratinjau mikrofon 15 detik**.
  Efek tidak diterapkan pada panggilan (`voiceActive = entitlement.active && prefs.enabled`).
- Tanpa penyedia pembayaran, UI menampilkan "penagihan belum terhubung" — tidak ada
  entitlement palsu yang di-hardcode.

## Privasi & guardrail

- Efek hanya memproses mikrofon lokal (outgoing). Audio lawan bicara tidak pernah disentuh.
- **Tidak ada perekaman**: tidak ada `MediaRecorder`, tidak ada buffer yang disimpan atau
  dikirim. Yang tersimpan hanya preferensi berupa angka/nama preset di `user_settings.voice`.
- Default **OFF**; indikator "Voice Privacy aktif" selalu terlihat oleh pengguna sendiri.
- Tidak ada voice cloning, unggah sampel suara orang lain, preset peniruan individu/tokoh,
  preset gender/usia ekstrem, maupun mode bypass verifikasi suara.

## Integrasi berikutnya (saat provider call dipasang)

1. Ambil mic dengan `MIC_CONSTRAINTS`.
2. `const pipe = new VoicePipeline(); const out = await pipe.attach(micStream);`
3. Kirim `out.getAudioTracks()[0]` ke sender WebRTC/LiveKit (`replaceTrack` bila call sudah jalan).
4. Ganti preset saat call: cukup `pipe.setParams(effectiveParams(prefs))` — tanpa renegosiasi,
   tanpa `replaceTrack`, sehingga panggilan tidak drop.
5. Mute: mute **track sumber** (`micStream.getAudioTracks()[0].enabled = false`), bukan gain
   pipeline, supaya status mute tetap konsisten dengan UI dan provider.
6. `pipe.dispose()` saat call berakhir.

Untuk panggilan native saat aplikasi di background (Android), audio path harus dipindah ke
plugin Capacitor (`AudioEffects`) yang mem-porting parameter yang sama; boundary sudah
dipisah lewat `VoicePipeline` sehingga UI tidak perlu berubah. Pekerjaan FCM/notifikasi
interaktif tidak tersentuh oleh fitur ini.

## QA checklist

- [x] Efek OFF = audio normal (test `effectiveParams` + bypass worklet).
- [x] Ganti preset saat pratinjau berjalan tidak me-restart stream (parameter di-ramp).
- [x] Parameter ekstrem selalu ter-clamp (unit test).
- [x] Preset tidak keluar batas privasi & tidak ada preset kloning (unit test).
- [x] Default OFF (unit test).
- [x] Fallback perangkat lemah → bypass + pesan, tanpa memutus stream.
- [x] Premium gating: non-premium tidak bisa memakai efek saat panggilan.
- [x] Tidak ada sampel suara mentah tersimpan (tidak ada API perekaman dipakai).
- [ ] Mute / speaker / Bluetooth / VC tidak tersendat — **menunggu provider call nyata**.
- [ ] Verifikasi AEC di perangkat Android fisik — **menunggu provider call nyata**.
