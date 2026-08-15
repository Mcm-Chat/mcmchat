/**
 * Nada panggilan MCM (tanpa file aset).
 *
 * - `ringback`: nada tunggu untuk pemanggil (400 Hz, pola 1 detik bunyi / 3 detik senyap).
 * - `ringtone`: nada dering untuk penerima + getar berkala.
 *
 * Dibangkitkan dengan WebAudio agar ukuran aplikasi tidak bertambah dan nada
 * tetap terdengar konsisten di semua perangkat. Semua pemutaran bersifat
 * best-effort: browser yang memblokir autoplay tidak boleh menggagalkan panggilan.
 */
export type TonePattern = "ringback" | "ringtone";

type Handle = { stop: () => void };

function createContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/** Mulai nada berulang; kembalikan penghenti idempotent. */
export function playTone(pattern: TonePattern): Handle {
  const ctx = createContext();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let vibrateTimer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    if (vibrateTimer) clearInterval(vibrateTimer);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(0);
    void ctx?.close().catch(() => undefined);
  };

  if (!ctx) return { stop };
  void ctx.resume().catch(() => undefined);

  const beep = (freq: number, durationSec: number, gainValue: number) => {
    if (stopped) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.05);
      gain.gain.setValueAtTime(gainValue, now + durationSec - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durationSec);
    } catch {
      /* nada bersifat pelengkap; kegagalan diabaikan */
    }
  };

  if (pattern === "ringback") {
    const cycle = () => beep(400, 1, 0.06);
    cycle();
    timer = setInterval(cycle, 4000);
  } else {
    const cycle = () => {
      beep(880, 0.35, 0.09);
      setTimeout(() => beep(660, 0.35, 0.09), 450);
    };
    cycle();
    timer = setInterval(cycle, 2200);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      const buzz = () => navigator.vibrate?.([400, 200, 400]);
      buzz();
      vibrateTimer = setInterval(buzz, 2200);
    }
  }

  return { stop };
}

/** Nada singkat saat panggilan berakhir (satu kali). */
export function playEndTone() {
  const ctx = createContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 320;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
    setTimeout(() => void ctx.close().catch(() => undefined), 600);
  } catch {
    void ctx.close().catch(() => undefined);
  }
}
