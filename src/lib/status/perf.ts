/** Utilitas mode performa editor status (murni, bisa diuji tanpa DOM). */

export type PerfMode = "quality" | "performance";

/** Resolusi kanvas pratinjau. Mode performa menggambar setengah piksel. */
export const previewSize = (mode: PerfMode, w: number, h: number) =>
  mode === "performance"
    ? { width: Math.round(w / 2), height: Math.round(h / 2) }
    : { width: w, height: h };

/** Jarak minimum antar titik goresan — makin besar, makin ringan. */
export const pointSpacing = (mode: PerfMode) => (mode === "performance" ? 20 : 8);

/** Jeda minimum antar penggambaran ulang (ms). ~30fps di mode performa. */
export const frameInterval = (mode: PerfMode) => (mode === "performance" ? 33 : 0);

/** Penghitung FPS sederhana dari deretan waktu frame. */
export class FpsMeter {
  private times: number[] = [];

  tick(now: number): number {
    this.times.push(now);
    while (this.times.length > 1 && now - this.times[0]! > 1000) this.times.shift();
    return this.fps;
  }

  get fps(): number {
    if (this.times.length < 2) return 0;
    const span = this.times[this.times.length - 1]! - this.times[0]!;
    if (span <= 0) return 0;
    return Math.round(((this.times.length - 1) * 1000) / span);
  }

  reset() {
    this.times = [];
  }
}
