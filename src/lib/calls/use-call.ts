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
import { getCallProvider, type CallSessionHandle, type ProviderState, type RemoteInfo } from "./provider";
import {
  answerCall,
  declineCall,
  endCall,
  getCall,
  leaveCall,
  subscribeCall,
  RING_TIMEOUT_MS,
  type CallRow,
} from "@/lib/api/calls";
import { MIC_CONSTRAINTS, VoicePipeline, type PipelineState } from "@/lib/voice/pipeline";
import { effectiveParams, type VoicePrefs } from "@/lib/voice/presets";

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
  voiceApplied: boolean;
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
  const [controls, setControls] = useState<CallControlsState>({ muted: false, cameraOn: false, speakerOn: true });
  const [pipelineState, setPipelineState] = useState<PipelineState>({ status: "idle", latencyMs: 0 });

  const sessionRef = useRef<CallSessionHandle | null>(null);
  const pipeRef = useRef<VoicePipeline | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const startedRef = useRef<number | null>(null);
  const joinedRef = useRef(false);
  const endedRef = useRef(false);

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
    if (!voiceApplied) return mic.getAudioTracks()[0] ?? null;
    const pipe = new VoicePipeline();
    pipeRef.current = pipe;
    pipe.onStateChange(setPipelineState);
    const out = await pipe.attach(mic);
    pipe.setParams(effectiveParams(prefs));
    return out.getAudioTracks()[0] ?? mic.getAudioTracks()[0] ?? null;
  }, [prefs, voiceApplied]);

  const join = useCallback(
    async (row: CallRow) => {
      if (joinedRef.current) return;
      joinedRef.current = true;
      setPhase("connecting");
      try {
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
            if (s.status === "failed") {
              setPhase("error");
              setReason(s.reason ?? "Koneksi media gagal");
            } else if (s.status === "connected") {
              setPhase("connected");
              startedRef.current ??= Date.now();
            } else if (s.status === "reconnecting") {
              setReason("Menyambung ulang…");
            }
          },
        });
        sessionRef.current = session;
        if (row.kind === "video") setControls((c) => ({ ...c, cameraOn: true }));
      } catch (e) {
        joinedRef.current = false;
        setPhase("error");
        setReason(e instanceof Error ? e.message : "Gagal menyambungkan panggilan");
      }
    },
    [buildOutgoingAudio, token],
  );

  const finish = useCallback(
    (status: CallRow["status"], why?: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const secs = startedRef.current ? (Date.now() - startedRef.current) / 1000 : 0;
      setPhase("ended");
      if (why) setReason(why);
      void cleanup();
      if (userId) void leaveCall(callId, userId).catch(() => undefined);
      void endCall(callId, status, secs, why).catch(() => undefined);
    },
    [callId, cleanup, userId],
  );

  // Muat panggilan + status penyedia, lalu tentukan fase awal.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const [cfg, row] = await Promise.all([config().catch(() => ({ configured: false })), getCall(callId)]);
      if (!alive) return;
      if (!row) {
        setPhase("error");
        setReason("Panggilan tidak ditemukan");
        return;
      }
      setCall(row);
      if (row.status === "ended" || row.status === "missed" || row.status === "declined" || row.status === "failed") {
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
        setPhase("outgoing");
        void join(row);
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
    const t = setInterval(() => setDuration(startedRef.current ? Math.floor((Date.now() - startedRef.current) / 1000) : 0), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Timeout dering: panggilan keluar yang tidak dijawab jadi "tak terjawab".
  useEffect(() => {
    if (phase !== "outgoing" && phase !== "incoming") return;
    const t = setTimeout(() => finish("missed", "Tidak dijawab"), RING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, finish]);

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
      voiceApplied,
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
      toggleSpeaker: () => setControls((c) => ({ ...c, speakerOn: !c.speakerOn })),
      switchCamera: () => void sessionRef.current?.switchCamera(),
      attachLocalVideo: (el) => sessionRef.current?.attachLocalVideo(el),
      attachRemoteVideo: (el) => sessionRef.current?.attachRemoteMedia(el),
    }),
    [phase, reason, call, remotes, durationSec, controls, pipelineState, voiceApplied, userId, callId, cleanup, finish, join],
  );
}
