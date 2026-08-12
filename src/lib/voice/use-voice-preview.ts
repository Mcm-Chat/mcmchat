import { useCallback, useEffect, useRef, useState } from "react";
import { MIC_CONSTRAINTS, VoicePipeline, type PipelineState } from "./pipeline";
import { effectiveParams, type VoicePrefs } from "./presets";

export type PreviewState = {
  running: boolean;
  level: number;
  pipeline: PipelineState;
  error: string | null;
};

/**
 * Pratinjau/tes mikrofon dengan efek aktif.
 *
 * Tidak ada perekaman sama sekali: stream mikrofon diproses langsung ke
 * elemen audio monitor dan dihentikan begitu pratinjau ditutup.
 */
export function useVoicePreview(prefs: VoicePrefs, opts?: { monitor?: boolean }) {
  const monitor = opts?.monitor ?? true;
  const pipeRef = useRef<VoicePipeline | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PreviewState>({
    running: false,
    level: 0,
    pipeline: { status: "idle", latencyMs: 0 },
    error: null,
  });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    void pipeRef.current?.dispose();
    pipeRef.current = null;
    setState((s) => ({ ...s, running: false, level: 0, pipeline: { status: "idle", latencyMs: 0 } }));
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState((s) => ({ ...s, error: "Mikrofon tidak tersedia di perangkat ini" }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      streamRef.current = stream;
      const pipe = new VoicePipeline();
      pipeRef.current = pipe;
      pipe.onStateChange((p) => setState((s) => ({ ...s, pipeline: p })));
      const out = await pipe.attach(stream);
      pipe.setParams(effectiveParams(prefs));
      if (monitor) {
        const el = new Audio();
        el.srcObject = out;
        el.autoplay = true;
        // Monitor lokal saja; tidak pernah direkam atau dikirim.
        await el.play().catch(() => undefined);
        audioRef.current = el;
      }
      setState((s) => ({ ...s, running: true, error: null }));
    } catch (e) {
      setState((s) => ({
        ...s,
        running: false,
        error: e instanceof Error && e.name === "NotAllowedError" ? "Izin mikrofon ditolak" : "Gagal membuka mikrofon",
      }));
      stop();
    }
  }, [prefs, monitor, stop]);

  // Parameter berubah saat pratinjau berjalan → diterapkan tanpa restart.
  useEffect(() => {
    pipeRef.current?.setParams(effectiveParams(prefs));
  }, [prefs]);

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => {
      setState((s) => ({ ...s, level: pipeRef.current?.level() ?? 0 }));
    }, 120);
    return () => window.clearInterval(id);
  }, [state.running]);

  useEffect(() => stop, [stop]);

  return { ...state, start, stop };
}
