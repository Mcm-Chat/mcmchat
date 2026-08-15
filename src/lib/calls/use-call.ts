/**
 * State machine panggilan MCM (satu sumber kebenaran untuk layar panggilan).
 *
 * Alur: loading → outgoing/incoming → connecting → connected → ended.
 * Sinyal (ringing/answer/decline/end) memakai tabel `calls` + Realtime, media
 * memakai `CallProvider`. Bila penyedia belum terhubung, fase `unconfigured`
 * dipakai dan tidak ada media apa pun yang dibuat.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCallConfig, issueCallToken } from "./calls.functions";
import {
  getCallProvider,
  type CallSessionHandle,
  type CallDevices,
  type ProviderState,
  type RemoteInfo,
} from "./provider";
import {
  answerCall,
  declineCall,
  endCall,
  getCall,
  joinCall,
  leaveCall,
  subscribeCall,
  ringRemainingMs,
  type CallRow,
} from "@/lib/api/calls";
import type { EndReason } from "./policy";
import {
  answerFailureText,
  connectFailureText,
  describeAnswerFailure,
  describeConnectFailure,
} from "./failure-messages";
import { MIC_CONSTRAINTS, VoicePipeline, type PipelineState } from "@/lib/voice/pipeline";
import { effectiveParams, type VoicePrefs } from "@/lib/voice/presets";

/**
 * Log teknis hanya saat pengembangan. Tidak pernah memuat token, secret, atau
 * SDP — hanya kode kesalahan pendek dan konteks non-sensitif.
 */
function devLog(code: string, detail?: unknown) {
  if (import.meta.env.DEV) console.warn(`[call:${code}]`, detail ?? "");
}

/** Bandingkan daftar peserta berdasarkan isi, bukan identitas objek. */
function sameRemotes(a: RemoteInfo[], b: RemoteInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.identity === y.identity &&
      x.name === y.name &&
      x.speaking === y.speaking &&
      x.micEnabled === y.micEnabled &&
      x.cameraEnabled === y.cameraEnabled
    );
  });
}

/**
 * Wake lock selama panggilan aktif. Sistem bisa melepas sentinel sendiri
 * (layar mati, tab tersembunyi); event `release` dipakai untuk mengambil ulang
 * hanya saat halaman terlihat dan panggilan masih aktif. Acquire ganda dicegah.
 */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    type Sentinel = {
      release: () => Promise<void>;
      addEventListener?: (t: "release", cb: () => void) => void;
      removeEventListener?: (t: "release", cb: () => void) => void;
    };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<Sentinel> };
    };
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    let acquiring = false;
    let disposed = false;

    const onRelease = () => {
      sentinel = null;
      if (!disposed && document.visibilityState === "visible") acquire();
    };
    const detach = (s: Sentinel) => s.removeEventListener?.("release", onRelease);

    function acquire() {
      if (disposed || acquiring || sentinel) return;
      acquiring = true;
      void nav
        .wakeLock!.request("screen")
        .then((s) => {
          acquiring = false;
          if (disposed) {
            void s.release().catch(() => undefined);
            return;
          }
          sentinel = s;
          s.addEventListener?.("release", onRelease);
        })
        .catch(() => {
          acquiring = false;
          devLog("wakelock_denied");
        });
    }

    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      const s = sentinel;
      sentinel = null;
      if (s) {
        detach(s);
        void s.release().catch(() => undefined);
      }
    };
  }, [active]);
}

export type CallPhase =
  | "loading"
  | "outgoing"
  | "incoming"
  | "connecting"
  | "connected"
  | "ended"
  | "unconfigured"
  | "error";

export type CallControlsState = { muted: boolean; cameraOn: boolean; speakerOn: boolean };

export type UseCallResult = {
  phase: CallPhase;
  reason: string | null;
  call: CallRow | null;
  remotes: RemoteInfo[];
  durationSec: number;
  controls: CallControlsState;
  pipelineState: PipelineState;
  /** Kualitas jaringan lokal untuk indikator sinyal. */
  quality: "excellent" | "good" | "poor" | "unknown";
  /** Efek suara benar-benar aktif pada track keluar (bukan sekadar preferensi). */
  voiceApplied: boolean;
  /** Efek suara diminta tetapi gagal dipasang; panggilan tetap berjalan polos. */
  voiceFallback: boolean;
  /** Tombol speaker hanya ditampilkan bila rute keluaran benar-benar bisa diatur. */
  speakerSupported: boolean;
  /** Autoplay audio diblokir; UI wajib menampilkan tombol "Aktifkan suara". */
  audioBlocked: boolean;
  enableAudio: () => void;
  answer: () => void;
  decline: () => void;
  hangup: (status?: CallRow["status"], reason?: string, code?: EndReason) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => void;
  /** Coba sambungkan ulang setelah status gagal, tanpa keluar dari layar. */
  retry: () => void;
  /** Percobaan sambung ulang manual sedang berjalan. */
  retrying: boolean;
  /** Daftar mic/kamera yang bisa dipilih saat panggilan berlangsung. */
  devices: CallDevices;
  micDeviceId: string | null;
  cameraDeviceId: string | null;
  refreshDevices: () => void;
  setMicDevice: (deviceId: string) => void;
  setCameraDevice: (deviceId: string) => void;
  attachLocalVideo: (el: HTMLVideoElement | null) => void;
  attachRemoteVideo: (el: HTMLVideoElement | null) => void;
};

export function useCall(opts: {
  callId: string;
  userId: string | undefined;
  prefs: VoicePrefs;
  /** Efek suara hanya diterapkan bila entitlement premium aktif. */
  premium: boolean;
}): UseCallResult {
  const { callId, userId, prefs, premium } = opts;
  const config = useServerFn(getCallConfig);
  const token = useServerFn(issueCallToken);

  const [phase, setPhase] = useState<CallPhase>("loading");
  const [reason, setReason] = useState<string | null>(null);
  const [call, setCall] = useState<CallRow | null>(null);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [durationSec, setDuration] = useState(0);
  const [controls, setControls] = useState<CallControlsState>({
    muted: false,
    cameraOn: false,
    speakerOn: true,
  });
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    status: "idle",
    latencyMs: 0,
  });
  const [voiceFallback, setVoiceFallback] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [speakerSupported, setSpeakerSupported] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [quality, setQuality] = useState<UseCallResult["quality"]>("unknown");
  const [devices, setDevices] = useState<CallDevices>({ mics: [], cameras: [] });
  const [micDeviceId, setMicDeviceId] = useState<string | null>(null);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const sessionRef = useRef<CallSessionHandle | null>(null);
  const pipeRef = useRef<VoicePipeline | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const startedRef = useRef<number | null>(null);
  const joinedRef = useRef(false);
  const endedRef = useRef(false);
  /** Percobaan sambung ulang otomatis setelah putus tak terduga. */
  const rejoinRef = useRef(0);
  /** Elemen video yang sudah mount sebelum sesi siap — dipasang saat sesi ada. */
  const localElRef = useRef<HTMLVideoElement | null>(null);
  const remoteElRef = useRef<HTMLVideoElement | null>(null);

  useWakeLock(phase === "connected" || phase === "connecting");

  const voiceApplied = premium && prefs.enabled && prefs.preset !== "off";

  const cleanup = useCallback(async () => {
    try {
      await sessionRef.current?.disconnect();
    } catch {
      /* pembongkaran tidak boleh melempar ke UI */
    }
    sessionRef.current = null;
    await pipeRef.current?.dispose();
    pipeRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
  }, []);

  /** Buka mikrofon dan (bila premium aktif) lewatkan ke VoicePipeline. */
  const buildOutgoingAudio = useCallback(async (
    deviceId?: string | null,
  ): Promise<MediaStreamTrack | null> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return null;
    const base = (MIC_CONSTRAINTS.audio ?? true) as MediaTrackConstraints;
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
      video: false,
    });
    micRef.current = mic;
    const raw = mic.getAudioTracks()[0] ?? null;
    setMicDeviceId(raw?.getSettings().deviceId ?? deviceId ?? null);
    if (!voiceApplied) return raw;
    // Kegagalan pemrosesan suara TIDAK boleh menggagalkan panggilan: kita
    // publikasikan mikrofon mentah dan menandai Voice Privacy tidak tersedia.
    try {
      const pipe = new VoicePipeline();
      pipeRef.current = pipe;
      pipe.onStateChange(setPipelineState);
      const out = await pipe.attach(mic);
      pipe.setParams(effectiveParams(prefs));
      const processed = out.getAudioTracks()[0] ?? null;
      if (!processed) throw new Error("Track efek suara tidak tersedia");
      setVoiceActive(true);
      setVoiceFallback(false);
      return processed;
    } catch {
      await pipeRef.current?.dispose().catch(() => undefined);
      pipeRef.current = null;
      setVoiceActive(false);
      setVoiceFallback(true);
      setPipelineState({ status: "failed", latencyMs: 0 });
      return raw;
    }
  }, [prefs, voiceApplied]);

  const join = useCallback(
    async (row: CallRow) => {
      if (joinedRef.current) return;
      joinedRef.current = true;
      setPhase("connecting");
      try {
        // Daftar hadir dulu (idempotent). Peserta yang sudah keluar/menolak
        // ditolak server, sehingga token hanya terbit untuk peserta aktif.
        await joinCall(row.id);
        const t = await token({ data: { callId: row.id } });
        if (!t.configured) {
          setPhase("unconfigured");
          setReason(t.reason ?? "Penyedia panggilan belum terhubung");
          joinedRef.current = false;
          return;
        }
        if (!("allowed" in t) || !t.allowed) {
          setPhase("ended");
          setReason(("reason" in t ? t.reason : null) ?? "Panggilan tidak tersedia");
          joinedRef.current = false;
          return;
        }
        const audio = await buildOutgoingAudio();
        const provider = getCallProvider(true);
        const session = await provider.connect({
          url: t.url,
          token: t.token,
          kind: row.kind,
          audioTrack: audio,
          onState: (s: ProviderState) => {
            // Perbandingan isi: peserta yang tidak berubah tidak boleh
            // memicu render ulang layar panggilan (hemat CPU/baterai).
            setRemotes((prev) => (sameRemotes(prev, s.remotes) ? prev : s.remotes));
            setAudioBlocked(Boolean(s.audioBlocked));
            setQuality(s.quality ?? "unknown");
            if (s.status === "failed") {
              devLog("media_failed", s.reason);
              // Putus tak terduga: coba sambung ulang otomatis dua kali dulu,
              // baru menyerah ke layar gagal. Ini mencegah panggilan mati
              // hanya karena jaringan seluler berpindah sel.
              if (s.unexpected && !endedRef.current && rejoinRef.current < 2) {
                rejoinRef.current += 1;
                setReason("Sinyal terputus — menyambungkan ulang…");
                setPhase("connecting");
                void cleanup().then(() => {
                  joinedRef.current = false;
                  if (!endedRef.current) setTimeout(() => void join(row), 1200);
                });
                return;
              }
              setPhase("error");
              setReason(connectFailureText(s.reason ?? "media"));
            } else if (s.status === "connected") {
              setPhase("connected");
              startedRef.current ??= Date.now();
              rejoinRef.current = 0;
              // Reconnected/Connected tanpa alasan membersihkan pesan lama
              // seperti "Menyambung ulang…" agar tidak basi di layar.
              setReason(s.reason ?? null);
            } else if (s.status === "reconnecting") {
              setReason("Menyambung ulang…");
            }
          },
        });
        sessionRef.current = session;
        // Elemen video yang mount lebih dulu (fase memanggil) baru bisa
        // dipasang sekarang; tanpa ini layar video tetap hitam.
        session.attachLocalVideo(localElRef.current);
        session.attachRemoteMedia(remoteElRef.current);
        setSpeakerSupported(session.speakerCapability === "sinkId");
        if (row.kind === "video") {
          // Panggilan video selalu dimulai dengan kamera aktif dan speaker
          // menyala, sama seperti aplikasi panggilan populer.
          setControls((c) => ({ ...c, cameraOn: true, speakerOn: true }));
          void session.setSpeaker(true).catch(() => undefined);
        }
      } catch (e) {
        joinedRef.current = false;
        devLog("join_failed", e instanceof Error ? e.message : "unknown");
        const info = describeConnectFailure(e);
        setPhase(info.outcome === "ended" ? "ended" : "error");
        setReason(`${info.message} ${info.action}`);
      }
    },
    [buildOutgoingAudio, cleanup, token],
  );

  /**
   * Akhiri sesi milik pengguna ini. Server memutuskan apakah panggilan ikut
   * berakhir: 1:1 dan pemanggil grup mengakhiri, peserta grup biasa hanya keluar.
   */
  const finish = useCallback(
    (status: CallRow["status"], why?: string, code?: EndReason) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const secs = startedRef.current ? (Date.now() - startedRef.current) / 1000 : 0;
      setPhase("ended");
      if (why) setReason(why);
      void cleanup();
      if (status === "ended") {
        void leaveCall(callId, secs).catch((e: unknown) => devLog("leave_failed", e));
      } else {
        void endCall(callId, status, secs, code).catch((e: unknown) => devLog("end_failed", e));
      }
    },
    [callId, cleanup],
  );

  // Muat panggilan + status penyedia, lalu tentukan fase awal.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const [cfg, row] = await Promise.all([
        config().catch(() => ({ configured: false })),
        getCall(callId),
      ]);
      if (!alive) return;
      if (!row) {
        setPhase("error");
        setReason("Panggilan tidak ditemukan");
        return;
      }
      setCall(row);
      if (
        row.status === "ended" ||
        row.status === "missed" ||
        row.status === "declined" ||
        row.status === "failed"
      ) {
        endedRef.current = true;
        setPhase("ended");
        return;
      }
      if (!cfg.configured) {
        setPhase("unconfigured");
        setReason("Penyedia panggilan belum terhubung");
        return;
      }
      const outgoing = row.initiator_id === userId;
      if (row.status === "ongoing") {
        startedRef.current = row.answered_at ? new Date(row.answered_at).getTime() : Date.now();
        void join(row);
      } else if (outgoing) {
        // Pemanggil TETAP "memanggil" sampai DB berubah menjadi `ongoing`;
        // media baru dibuka setelah penerima benar-benar menjawab.
        setPhase("outgoing");
      } else {
        setPhase("incoming");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, userId]);

  // Sinyal realtime: kedua sisi selalu melihat status yang sama.
  useEffect(() => {
    if (!userId) return;
    return subscribeCall(callId, (row) => {
      setCall(row);
      if (row.status === "ongoing") {
        startedRef.current ??= row.answered_at ? new Date(row.answered_at).getTime() : Date.now();
        if (row.initiator_id === userId) void join(row);
      }
      if (row.status === "declined") finish("declined", "Panggilan ditolak", "declined");
      if (row.status === "missed") finish("missed", "Tak terjawab", "timeout");
      if (row.status === "ended" && !endedRef.current) {
        endedRef.current = true;
        setPhase("ended");
        void cleanup();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, userId]);

  // Timer durasi — satu render per detik dan hanya bila detiknya berubah.
  useEffect(() => {
    if (phase !== "connected") return;
    const tick = () => {
      const secs = startedRef.current
        ? Math.floor((Date.now() - startedRef.current) / 1000)
        : 0;
      setDuration((prev) => (prev === secs ? prev : secs));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [phase]);

  /** Ref callback stabil: tidak memicu attach berulang tiap render. */
  const attachLocalVideo = useCallback((el: HTMLVideoElement | null) => {
    localElRef.current = el;
    sessionRef.current?.attachLocalVideo(el);
  }, []);
  const attachRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteElRef.current = el;
    sessionRef.current?.attachRemoteMedia(el);
  }, []);

  // Timeout dering absolut: dihitung dari `created_at`, bukan dari saat layar
  // dibuka, dan idempotent karena `finish` menolak pemanggilan kedua.
  useEffect(() => {
    if (phase !== "outgoing" && phase !== "incoming") return;
    if (!call) return;
    // Batas 45 detik => tak terjawab (timeout). Pemanggil yang menutup lebih
    // dulu memakai jalur `hangup` dan dicatat server sebagai `cancelled`.
    const t = setTimeout(
      () => finish("missed", "Tidak dijawab", "timeout"),
      ringRemainingMs(call.created_at),
    );
    return () => clearTimeout(t);
  }, [phase, finish, call]);

  // Ganti preset saat panggilan berjalan — tanpa renegosiasi, panggilan tidak drop.
  useEffect(() => {
    pipeRef.current?.setParams(effectiveParams(prefs));
  }, [prefs]);

  useEffect(() => () => void cleanup(), [cleanup]);

  /** Enumerasi perangkat input; label hanya terisi bila izin sudah diberikan. */
  const refreshDevices = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        const map = (kind: MediaDeviceKind, fallback: string) =>
          list
            .filter((d) => d.kind === kind && d.deviceId)
            .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
        setDevices({
          mics: map("audioinput", "Mikrofon"),
          cameras: map("videoinput", "Kamera"),
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (phase !== "connected" && phase !== "connecting") return;
    refreshDevices();
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.addEventListener) return;
    const onChange = () => refreshDevices();
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [phase, refreshDevices]);

  /** Ganti mikrofon tanpa memutus panggilan: bangun ulang track lalu replace. */
  const setMicDevice = useCallback(
    (deviceId: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const prevMic = micRef.current;
      const prevPipe = pipeRef.current;
      pipeRef.current = null;
      void buildOutgoingAudio(deviceId)
        .then(async (track) => {
          if (!track) throw new Error("Mikrofon tidak tersedia");
          await session.replaceAudioTrack(track);
          track.enabled = !controls.muted;
          await prevPipe?.dispose().catch(() => undefined);
          prevMic?.getTracks().forEach((t) => t.stop());
          refreshDevices();
        })
        .catch(() => {
          pipeRef.current = prevPipe;
          micRef.current = prevMic;
          setReason("Mikrofon itu tidak bisa dipakai saat ini");
        });
    },
    [buildOutgoingAudio, controls.muted, refreshDevices],
  );

  const setCameraDevice = useCallback(
    (deviceId: string) => {
      const session = sessionRef.current;
      if (!session) return;
      void session.setVideoInput(deviceId).then((ok) => {
        if (ok) setCameraDeviceId(deviceId);
        else setReason("Kamera itu tidak bisa dipakai saat ini");
      });
    },
    [],
  );

  /**
   * Pemulihan manual dari status gagal: bongkar sesi lama, reset penghitung
   * sambung-ulang otomatis, lalu bergabung lagi ke panggilan yang sama.
   */
  const retry = useCallback(() => {
    const row = call;
    if (!row || endedRef.current) return;
    setRetrying(true);
    setReason("Mencoba menyambungkan ulang…");
    setPhase("connecting");
    rejoinRef.current = 0;
    void cleanup()
      .then(() => {
        joinedRef.current = false;
        return join(row);
      })
      .finally(() => setRetrying(false));
  }, [call, cleanup, join]);

  return useMemo<UseCallResult>(
    () => ({
      phase,
      reason,
      call,
      remotes,
      durationSec,
      controls,
      pipelineState,
      quality,
      voiceApplied: voiceActive,
      voiceFallback,
      speakerSupported,
      audioBlocked,
      enableAudio: () => {
        void sessionRef.current?.startAudio().then((ok) => {
          setAudioBlocked(!ok);
          if (ok) setReason(null);
        });
      },
      answer: () => {
        if (!userId || !call) return;
        void answerCall(call.id)
          .then(() => join({ ...call, status: "ongoing" }))
          .catch((e: unknown) => {
            // Gagal mengangkat: sampaikan penyebab + langkah berikutnya, dan
            // jangan biarkan layar menggantung di fase "berdering".
            const info = describeAnswerFailure(e);
            devLog("answer_failed", e instanceof Error ? e.message : "unknown");
            setReason(answerFailureText(e));
            if (info.outcome === "ended") {
              endedRef.current = true;
              setPhase("ended");
              void cleanup();
            } else {
              setPhase("error");
            }
          });
      },
      decline: () => {
        if (endedRef.current) return;
        endedRef.current = true;
        setPhase("ended");
        setReason("Panggilan ditolak");
        void cleanup();
        void declineCall(callId).catch(() => undefined);
      },
      // Menutup panggilan keluar yang masih berdering = pembatalan; server yang
      // menetapkan statusnya (`ended` + `cancelled`), klien tidak menebak.
      hangup: (status = "ended", why, code) => finish(status, why, code),
      toggleMute: () => {
        setControls((c) => {
          const muted = !c.muted;
          // Mute pada track sumber agar konsisten dengan UI dan penyedia.
          micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
          void sessionRef.current?.setMicEnabled(!muted);
          return { ...c, muted };
        });
      },
      toggleCamera: () => {
        setControls((c) => {
          const cameraOn = !c.cameraOn;
          void sessionRef.current?.setCameraEnabled(cameraOn);
          return { ...c, cameraOn };
        });
      },
      // Tidak ada toggle palsu: state hanya berubah bila perangkat keluaran
      // memang berhasil dipindah oleh browser/penyedia.
      toggleSpeaker: () => {
        const next = !controls.speakerOn;
        void sessionRef.current?.setSpeaker(next).then((applied) => {
          if (applied === null) {
            setSpeakerSupported(false);
            return;
          }
          setControls((c) => ({ ...c, speakerOn: applied }));
        });
      },
      switchCamera: () => void sessionRef.current?.switchCamera(),
      retry,
      retrying,
      devices,
      micDeviceId,
      cameraDeviceId,
      refreshDevices,
      setMicDevice,
      setCameraDevice,
      attachLocalVideo,
      attachRemoteVideo,
    }),
    [
      phase,
      reason,
      call,
      remotes,
      durationSec,
      controls,
      pipelineState,
      quality,
      voiceActive,
      voiceFallback,
      speakerSupported,
      audioBlocked,
      userId,
      callId,
      cleanup,
      finish,
      join,
      retry,
      retrying,
      devices,
      micDeviceId,
      cameraDeviceId,
      refreshDevices,
      setMicDevice,
      setCameraDevice,
      attachLocalVideo,
      attachRemoteVideo,
    ],
  );
}
