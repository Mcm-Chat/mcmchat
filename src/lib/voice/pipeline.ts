/**
 * Pipeline audio Voice Privacy (browser / Capacitor WebView).
 *
 * Kontrak penting:
 * - Hanya memproses MediaStream mikrofon LOKAL (outgoing). Audio lawan bicara
 *   tidak pernah disentuh.
 * - Constraint `echoCancellation`, `noiseSuppression`, dan `autoGainControl`
 *   milik WebRTC tetap menyala pada sumber; efek dipasang SETELAH tahap itu
 *   sehingga AEC/NS bawaan perangkat tidak dilumpuhkan.
 * - Tidak ada perekaman: tidak ada MediaRecorder, tidak ada buffer yang
 *   disimpan atau dikirim ke server.
 * - Bila AudioWorklet tidak tersedia atau pemrosesan gagal/terlalu berat,
 *   pipeline otomatis bypass ke suara asli tanpa memutus stream.
 */
import { NEUTRAL, type VoiceParams } from "./presets";

export type PipelineStatus = "idle" | "active" | "bypass" | "unsupported" | "failed";

export type PipelineState = {
  status: PipelineStatus;
  /** Alasan singkat berbahasa Indonesia untuk ditampilkan ke pengguna. */
  reason?: string;
  /** Perkiraan latency tambahan pemrosesan dalam milidetik. */
  latencyMs: number;
};

export const WORKLET_URL = "/worklets/mcm-voice-privacy.js";

export function audioSupported(): boolean {
  return typeof window !== "undefined" && typeof window.AudioContext !== "undefined";
}

export function workletSupported(): boolean {
  return audioSupported() && typeof AudioWorkletNode !== "undefined";
}

/** Constraint mikrofon standar: AEC/NS/AGC perangkat tetap aktif. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
  video: false,
};

type Nodes = {
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode | null;
  lowShelf: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  bandpass: BiquadFilterNode;
  dry: GainNode;
  wetDelay: DelayNode;
  wetFeedback: GainNode;
  wet: GainNode;
  out: GainNode;
  dest: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
};

/**
 * Pipeline satu arah: mic → [worklet pitch/formant/gate/denoise] → EQ →
 * reverb ringan → gain → MediaStreamDestination (dipasang ke sender WebRTC).
 */
export class VoicePipeline {
  private ctx: AudioContext | null = null;
  private nodes: Nodes | null = null;
  private params: VoiceParams = { ...NEUTRAL };
  private bypassed = false;
  private listeners = new Set<(s: PipelineState) => void>();
  private state: PipelineState = { status: "idle", latencyMs: 0 };

  get outputStream(): MediaStream | null {
    return this.nodes?.dest.stream ?? null;
  }

  getState(): PipelineState {
    return this.state;
  }

  onStateChange(cb: (s: PipelineState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(next: Partial<PipelineState>) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l(this.state);
  }

  /** Ambil level RMS 0..1 untuk indikator meter (tanpa menyimpan sampel). */
  level(): number {
    const analyser = this.nodes?.analyser;
    if (!analyser) return 0;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  /**
   * Pasang efek pada stream mikrofon. Mengembalikan stream terproses;
   * bila tidak didukung, mengembalikan stream asli (suara normal).
   */
  async attach(input: MediaStream): Promise<MediaStream> {
    if (!audioSupported()) {
      this.emit({
        status: "unsupported",
        reason: "Perangkat tidak mendukung pemrosesan audio",
        latencyMs: 0,
      });
      return input;
    }
    try {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      await ctx.resume().catch(() => undefined);
      let worklet: AudioWorkletNode | null = null;
      if (workletSupported()) {
        try {
          await ctx.audioWorklet.addModule(WORKLET_URL);
          worklet = new AudioWorkletNode(ctx, "mcm-voice-privacy", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
          });
          worklet.onprocessorerror = () => this.fallback("Pemrosesan suara gagal di perangkat ini");
        } catch {
          worklet = null;
        }
      }

      const source = ctx.createMediaStreamSource(input);
      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = "lowshelf";
      lowShelf.frequency.value = 220;
      const highShelf = ctx.createBiquadFilter();
      highShelf.type = "highshelf";
      highShelf.frequency.value = 3200;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "peaking";
      bandpass.frequency.value = 1800;
      bandpass.Q.value = 0.9;
      bandpass.gain.value = 0;

      const dry = ctx.createGain();
      const wetDelay = ctx.createDelay(0.2);
      wetDelay.delayTime.value = 0.045;
      const wetFeedback = ctx.createGain();
      wetFeedback.gain.value = 0.2;
      const wet = ctx.createGain();
      wet.gain.value = 0;
      const out = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const dest = ctx.createMediaStreamDestination();

      const head: AudioNode = worklet ?? lowShelf;
      if (worklet) {
        source.connect(worklet);
        worklet.connect(lowShelf);
      } else {
        source.connect(lowShelf);
      }
      void head;
      lowShelf.connect(highShelf);
      highShelf.connect(bandpass);
      bandpass.connect(dry);
      dry.connect(out);
      bandpass.connect(wetDelay);
      wetDelay.connect(wetFeedback);
      wetFeedback.connect(wetDelay);
      wetDelay.connect(wet);
      wet.connect(out);
      out.connect(analyser);
      out.connect(dest);

      this.ctx = ctx;
      this.nodes = {
        source,
        worklet,
        lowShelf,
        highShelf,
        bandpass,
        dry,
        wetDelay,
        wetFeedback,
        wet,
        out,
        dest,
        analyser,
      };
      const latencyMs = Math.round(
        ((ctx.baseLatency ?? 0) + (worklet ? 1024 / ctx.sampleRate : 0)) * 1000,
      );
      this.emit({
        status: worklet ? "active" : "bypass",
        latencyMs,
        ...(worklet
          ? {}
          : { reason: "Perangkat tidak mendukung AudioWorklet — suara normal dipakai" }),
      });
      this.setParams(this.params);
      return dest.stream;
    } catch {
      this.emit({
        status: "failed",
        reason: "Efek suara gagal dimuat — kembali ke suara normal",
        latencyMs: 0,
      });
      return input;
    }
  }

  /** Terapkan parameter baru tanpa memutus stream (aman dipanggil saat call). */
  setParams(params: VoiceParams) {
    this.params = params;
    const n = this.nodes;
    const ctx = this.ctx;
    if (!n || !ctx) return;
    const t = ctx.currentTime;
    const ramp = 0.05;
    const tone = params.tone;
    n.lowShelf.gain.setTargetAtTime(-tone * 6, t, ramp);
    n.highShelf.gain.setTargetAtTime(tone * 6, t, ramp);
    n.bandpass.gain.setTargetAtTime(params.character * 8, t, ramp);
    n.wet.gain.setTargetAtTime(this.bypassed ? 0 : params.reverb, t, ramp);
    n.dry.gain.setTargetAtTime(1, t, ramp);
    n.out.gain.setTargetAtTime(this.bypassed ? 1 : Math.pow(10, params.gain / 20), t, ramp);
    n.worklet?.port.postMessage({
      type: "params",
      bypass: this.bypassed,
      params: {
        pitch: params.pitch,
        formant: params.formant,
        gate: params.gate,
        denoise: params.denoise,
        character: params.character,
      },
    });
  }

  /** Matikan efek (suara normal) tanpa membongkar graph — dipakai saat fallback. */
  setBypass(bypass: boolean) {
    this.bypassed = bypass;
    this.setParams(this.params);
    if (this.state.status !== "unsupported" && this.state.status !== "failed") {
      this.emit({ status: bypass ? "bypass" : "active" });
    }
  }

  private fallback(reason: string) {
    this.setBypass(true);
    this.emit({ status: "failed", reason });
  }

  async dispose() {
    try {
      this.nodes?.source.disconnect();
      this.nodes?.worklet?.disconnect();
      this.nodes?.out.disconnect();
      await this.ctx?.close();
    } catch {
      /* abaikan: pembongkaran audio tidak boleh melempar ke UI */
    }
    this.ctx = null;
    this.nodes = null;
    this.emit({ status: "idle", latencyMs: 0 });
  }
}
