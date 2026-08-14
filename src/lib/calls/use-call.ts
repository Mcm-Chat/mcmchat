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
  type ProviderState,
  type RemoteInfo,
} from "./provider";
import {
  answerCall,
  countParticipants,
  declineCall,
  endCall,
  getCall,
  joinCall,
  leaveCall,
  subscribeCall,
  ringRemainingMs,
  type CallRow,
} from "@/lib/api/calls";
import { MIC_CONSTRAINTS, VoicePipeline, type PipelineState } from "@/lib/voice/pipeline";
import { effectiveParams, type VoicePrefs } from "@/lib/voice/presets";

/**
 * Log teknis hanya saat pengembangan. Tidak pernah memuat token, secret, atau
 * SDP — hanya kode kesalahan pendek dan konteks non-sensitif.
 */
function devLog(code: string, detail?: unknown) {
  if (import.meta.env.DEV) console.warn(`[call:${code}]`, detail ?? "");
}

/** Wake lock selama panggilan aktif; aman bila browser tidak mendukung. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined") return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let disposed = false;
    const acquire = () => {
      void nav
        .wakeLock!.request("screen")
        .then((s) => {
          if (disposed) void s.release().catch(() => undefined);
          else sentinel = s;
        })
        .catch(() => devLog("wakelock_denied"));
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !sentinel) acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
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
  hangup: (status?: CallRow["status"], reason?: string) => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => void;
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

  const sessionRef = useRef<CallSessionHandle | null>(null);
  const pipeRef = useRef<VoicePipeline | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const startedRef = useRef<number | null>(null);
  const joinedRef = useRef(false);
  const endedRef = useRef(false);
  const participantsRef = useRef<number>(2);

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
  const buildOutgoingAudio = useCallback(async (): Promise<MediaStreamTrack | null> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return null;
    const mic = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    micRef.current = mic;
    const raw = mic.getAudioTracks()[0] ?? null;
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
        // Daftar hadir dulu (idempotent, membatalkan `left_at`) supaya token
        // hanya terbit untuk peserta yang benar-benar aktif.
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
            setRemotes(s.remotes);
            setAudioBlocked(Boolean(s.audioBlocked));
            if (s.status === "failed") {
              devLog("media_failed", s.reason);
              setPhase("error");
              setReason(s.reason ?? "Koneksi media gagal");
            } else if (s.status === "connected") {
              setPhase("connected");
              startedRef.current ??= Date.now();
              if (s.reason) setReason(s.reason);
            } else if (s.status === "reconnecting") {
              setReason("Menyambung ulang…");
            }
          },
        });
        sessionRef.current = session;
        setSpeakerSupported(session.speakerCapability === "sinkId");
        if (row.kind === "video") setControls((c) => ({ ...c, cameraOn: true }));
      } catch (e) {
        joinedRef.current = false;
        devLog("join_failed", e instanceof Error ? e.message : "unknown");
        setPhase("error");
        setReason(e instanceof Error ? e.message : "Gagal menyambungkan panggilan");
      }
    },
    [buildOutgoingAudio, token],
  );

  /**
   * Akhiri sesi milik pengguna ini. Server memutuskan apakah panggilan ikut
   * berakhir: 1:1 dan pemanggil grup mengakhiri, peserta grup biasa hanya keluar.
   */
  const finish = useCallback(
    (status: CallRow["status"], why?: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const secs = startedRef.current ? (Date.now() - startedRef.current) / 1000 : 0;
      setPhase("ended");
      if (why) setReason(why);
      void cleanup();
      if (status === "ended") {
        void leaveCall(callId, secs).catch((e: unknown) => devLog("leave_failed", e));
      } else {
        void endCall(callId, status, secs, why).catch((e: unknown) => devLog("end_failed", e));
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
      void countParticipants(callId)
        .then((n) => (participantsRef.current = n || 2))
        .catch(() => undefined);
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
      if (row.status === "declined") finish("declined", "Panggilan ditolak");
      if (row.status === "missed") finish("missed", "Tak terjawab");
      if (row.status === "ended" && !endedRef.current) {
        endedRef.current = true;
        setPhase("ended");
        void cleanup();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, userId]);

  // Timer durasi.
  useEffect(() => {
    if (phase !== "connected") return;
    const t = setInterval(
      () =>
        setDuration(startedRef.current ? Math.floor((Date.now() - startedRef.current) / 1000) : 0),
      500,
    );
    return () => clearInterval(t);
  }, [phase]);

  // Timeout dering absolut: dihitung dari `created_at`, bukan dari saat layar
  // dibuka, dan idempotent karena `finish` menolak pemanggilan kedua.
  useEffect(() => {
    if (phase !== "outgoing" && phase !== "incoming") return;
    if (!call) return;
    const t = setTimeout(() => finish("missed", "Tidak dijawab"), ringRemainingMs(call.created_at));
    return () => clearTimeout(t);
  }, [phase, finish, call]);

  // Ganti preset saat panggilan berjalan — tanpa renegosiasi, panggilan tidak drop.
  useEffect(() => {
    pipeRef.current?.setParams(effectiveParams(prefs));
  }, [prefs]);

  useEffect(() => () => void cleanup(), [cleanup]);

  return useMemo<UseCallResult>(
    () => ({
      phase,
      reason,
      call,
      remotes,
      durationSec,
      controls,
      pipelineState,
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
          .catch((e: unknown) => setReason(e instanceof Error ? e.message : "Gagal menjawab"));
      },
      decline: () => {
        if (endedRef.current) return;
        endedRef.current = true;
        setPhase("ended");
        setReason("Panggilan ditolak");
        void cleanup();
        void declineCall(callId).catch(() => undefined);
      },
      hangup: (status = "ended", why) => finish(status, why),
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
      attachLocalVideo: (el) => sessionRef.current?.attachLocalVideo(el),
      attachRemoteVideo: (el) => sessionRef.current?.attachRemoteMedia(el),
    }),
    [
      phase,
      reason,
      call,
      remotes,
      durationSec,
      controls,
      pipelineState,
      voiceActive,
      voiceFallback,
      speakerSupported,
      audioBlocked,
      userId,
      callId,
      cleanup,
      finish,
      join,
    ],
  );
}
