/**
 * MCM Voice Privacy — AudioWorkletProcessor.
 *
 * Memproses HANYA audio mikrofon lokal (outgoing) di dalam audio thread.
 * Tidak menyimpan, mengirim, atau merekam sampel suara: buffer bersifat
 * ring-buffer sementara dan dibuang begitu frame diproses.
 *
 * Teknik: overlap-add granular pitch/formant shift (2 grain, crossfade
 * Hann) + noise gate dengan attack/release + ekspander derau ringan +
 * karakter (soft-clip & ring-mod halus). Semua O(n) per frame agar aman
 * di perangkat kelas bawah.
 */

const GRAIN = 1024; // ~21 ms @48 kHz — kompromi latency vs artefak
const HALF = GRAIN / 2;

function hann(i, n) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
}

class VoicePrivacyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(GRAIN * 4);
    this.write = 0;
    this.readA = 0;
    this.readB = HALF;
    this.env = 0;
    this.gateGain = 0;
    this.noiseFloor = 1e-4;
    this.phase = 0;
    this.bypass = true;
    this.p = { pitch: 0, formant: 0, gate: -60, denoise: 0, character: 0 };
    this.window = new Float32Array(GRAIN);
    for (let i = 0; i < GRAIN; i++) this.window[i] = hann(i, GRAIN);

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === "params") {
        this.p = { ...this.p, ...d.params };
        this.bypass = Boolean(d.bypass);
      }
    };
  }

  /** Ambil sampel dari ring-buffer dengan interpolasi linier. */
  sample(pos) {
    const n = this.buf.length;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = this.buf[((i0 % n) + n) % n];
    const b = this.buf[(((i0 + 1) % n) + n) % n];
    return a + (b - a) * frac;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;
    const inCh = input[0];
    const outCh = output[0];
    if (!inCh) {
      outCh.fill(0);
      return true;
    }

    if (this.bypass) {
      outCh.set(inCh);
      for (let c = 1; c < output.length; c++) output[c].set(inCh);
      return true;
    }

    const n = this.buf.length;
    const ratio = Math.pow(2, (this.p.pitch || 0) / 12);
    const formant = Math.pow(2, (this.p.formant || 0) * 0.35);
    const gateThresh = Math.pow(10, (this.p.gate ?? -60) / 20);
    const denoise = this.p.denoise || 0;
    const character = this.p.character || 0;

    for (let i = 0; i < inCh.length; i++) {
      const x = inCh[i];

      // --- envelope follower + noise gate + ekspander derau ---
      const absx = Math.abs(x);
      this.env += (absx - this.env) * (absx > this.env ? 0.25 : 0.005);
      this.noiseFloor +=
        (Math.min(this.noiseFloor * 1.5 + 1e-6, this.env) - this.noiseFloor) * 0.0005;
      const open = this.env > gateThresh ? 1 : 0;
      this.gateGain += (open - this.gateGain) * (open ? 0.35 : 0.02);
      let g = this.gateGain;
      if (denoise > 0) {
        const snr = this.env / (this.noiseFloor + 1e-9);
        const soft = Math.min(1, Math.max(0, (snr - 1.5) / 4));
        g *= 1 - denoise * (1 - soft);
      }

      this.buf[this.write] = x * g;
      this.write = (this.write + 1) % n;

      // --- granular pitch/formant shift (dua grain saling silang) ---
      const step = ratio * formant;
      this.readA += step;
      this.readB += step;
      const distA = (((this.write - this.readA) % n) + n) % n;
      const distB = (((this.write - this.readB) % n) + n) % n;
      if (distA > GRAIN * 2 || distA < 2) this.readA = this.write - HALF;
      if (distB > GRAIN * 2 || distB < 2) this.readB = this.write - GRAIN;

      const wA = this.window[Math.min(GRAIN - 1, Math.floor((distA / (GRAIN * 2)) * GRAIN))];
      const wB = this.window[Math.min(GRAIN - 1, Math.floor((distB / (GRAIN * 2)) * GRAIN))];
      const denom = wA + wB || 1;
      let y = (this.sample(this.readA) * wA + this.sample(this.readB) * wB) / denom;

      // --- karakter ringan: ring-mod halus + soft clip (radio/robot) ---
      if (character > 0) {
        this.phase += (2 * Math.PI * 85) / sampleRate;
        if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
        const ring = 1 - character * 0.5 + character * 0.5 * Math.cos(this.phase);
        y = y * ring;
        const drive = 1 + character * 3;
        y = Math.tanh(y * drive) / Math.tanh(drive);
      }

      if (!Number.isFinite(y)) y = 0;
      outCh[i] = Math.max(-1, Math.min(1, y));
    }

    for (let c = 1; c < output.length; c++) output[c].set(outCh);
    return true;
  }
}

registerProcessor("mcm-voice-privacy", VoicePrivacyProcessor);
