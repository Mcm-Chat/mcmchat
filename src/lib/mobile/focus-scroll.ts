/**
 * Auto-scroll ke field yang sedang diisi saat keyboard (IME) muncul.
 *
 * Android WebView sering hanya "pan" sebagian, sehingga input di bagian bawah
 * form tetap tertutup keyboard. Listener global ini memantau `focusin` dan
 * perubahan visualViewport, lalu menggulir elemen aktif ke area yang terlihat
 * bila tertutup keyboard atau keluar dari viewport visual.
 */

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const MARGIN = 16;

function isEditable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.matches("input[type='hidden']")) return false;
  return el.matches(EDITABLE);
}

/** Area terlihat (di atas keyboard) pada koordinat viewport layout. */
function visibleBottom(): number {
  const vv = window.visualViewport;
  if (!vv) return window.innerHeight;
  return vv.offsetTop + vv.height;
}

function ensureVisible(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return;
  const top = window.visualViewport?.offsetTop ?? 0;
  const bottom = visibleBottom();
  const hiddenBelow = rect.bottom + MARGIN > bottom;
  const hiddenAbove = rect.top - MARGIN < top;
  if (!hiddenBelow && !hiddenAbove) return;

  const reduce = document.documentElement.classList.contains("reduce-motion");
  el.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: reduce ? "auto" : "smooth",
  });
}

/** Pasang sekali (root). Mengembalikan fungsi cleanup. */
export function installFocusScroll(): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: number | undefined;
  let active: HTMLElement | null = null;

  const schedule = (delay: number) => {
    if (!active) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      if (active && document.contains(active) && document.activeElement === active) {
        ensureVisible(active);
      }
    }, delay);
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as Element | null;
    if (!isEditable(target)) {
      active = null;
      return;
    }
    active = target;
    // Keyboard butuh waktu untuk animasi buka; ukur setelah viewport stabil.
    schedule(220);
  };

  const onFocusOut = () => {
    active = null;
    if (timer) window.clearTimeout(timer);
    timer = undefined;
  };

  // Saat keyboard benar-benar membuka/berubah tinggi, ukur ulang.
  const onViewportChange = () => schedule(60);

  window.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("focusout", onFocusOut, true);
  window.visualViewport?.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);

  return () => {
    if (timer) window.clearTimeout(timer);
    window.removeEventListener("focusin", onFocusIn, true);
    window.removeEventListener("focusout", onFocusOut, true);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.removeEventListener("orientationchange", onViewportChange);
  };
}
