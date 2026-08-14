/**
 * Metrik viewport mobile (Android WebView / Capacitor).
 *
 * Satu listener global menulis dua CSS variable pada <html>:
 * - `--mcm-kb` : tinggi keyboard (IME) yang menutupi layout viewport.
 * - `--mcm-vh` : tinggi visual viewport aktual dalam px.
 *
 * Bila WebView memang me-resize saat keyboard muncul (adjustResize), nilai
 * `--mcm-kb` otomatis 0 sehingga tidak terjadi double inset. Bila WebView
 * hanya "pan" (tidak resize), nilai ini menjadi inset yang benar.
 */

export interface ViewportSample {
  innerHeight: number;
  visualHeight: number;
  offsetTop: number;
}

/** Inset keyboard = bagian layout viewport yang tidak terlihat di bawah. */
export function keyboardInset(sample: ViewportSample): number {
  const hidden = sample.innerHeight - (sample.visualHeight + sample.offsetTop);
  if (!Number.isFinite(hidden)) return 0;
  // Toleransi kecil agar bilah URL / pembulatan tidak dianggap keyboard.
  return hidden > 60 ? Math.round(hidden) : 0;
}

export function isKeyboardOpen(sample: ViewportSample): boolean {
  return keyboardInset(sample) > 0;
}

/** Pasang sekali (root). Mengembalikan fungsi cleanup. */
export function installViewportMetrics(): () => void {
  if (typeof window === "undefined") return () => {};
  const root = document.documentElement;
  const vv = window.visualViewport;
  let frame = 0;

  const apply = () => {
    frame = 0;
    const sample: ViewportSample = {
      innerHeight: window.innerHeight,
      visualHeight: vv?.height ?? window.innerHeight,
      offsetTop: vv?.offsetTop ?? 0,
    };
    const kb = keyboardInset(sample);
    root.style.setProperty("--mcm-kb", `${kb}px`);
    root.style.setProperty("--mcm-vh", `${Math.round(sample.visualHeight)}px`);
    root.dataset["keyboard"] = kb > 0 ? "open" : "closed";
  };

  // Semua event digabung ke satu rAF agar tidak terjadi layout thrash.
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(apply);
  };

  apply();
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", schedule);
  window.addEventListener("resize", schedule);

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("resize", schedule);
    root.style.removeProperty("--mcm-kb");
    root.style.removeProperty("--mcm-vh");
    delete root.dataset["keyboard"];
  };
}
