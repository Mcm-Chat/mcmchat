import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Focus trap + Escape-to-close + automatic focus restore for hand-rolled modal
 * surfaces (Radix dialogs already provide this natively).
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(options: {
  onClose: () => void;
  active?: boolean | undefined;
  closeOnEscape?: boolean | undefined;
  /**
   * Sasaran cadangan bila elemen pemicu sudah hilang dari DOM (misalnya modal
   * ditutup oleh timeout setelah pindah halaman). Tanpa ini fokus jatuh ke
   * <body> dan pengguna keyboard kehilangan posisi.
   */
  fallbackFocus?: (() => HTMLElement | null) | undefined;
  /**
   * Trap dijeda sementara (misalnya sheet perangkat/efek suara sedang terbuka
   * di atas panel). Berbeda dengan `active: false`, jeda TIDAK memindahkan
   * fokus ke mana pun: fokus tetap milik sheet, lalu saat sheet menutup Radix
   * mengembalikannya ke tombol pemicu di dalam panel dan trap menyala lagi
   * tanpa melompat.
   */
  suspended?: boolean | undefined;
}) {
  const {
    onClose,
    active = true,
    closeOnEscape = true,
    fallbackFocus,
    suspended = false,
  } = options;
  const containerRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;
  // Diperbarui saat render sehingga cleanup efek membaca nilai TERBARU dan
  // bisa membedakan "trap dijeda" dari "modal benar-benar ditutup".
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  // Menandai bahwa run efek berikutnya adalah "lanjut setelah jeda", bukan
  // pembukaan modal baru — fokus tidak boleh dipindahkan lagi.
  const resumingRef = useRef(false);

  useEffect(() => {
    if (!active || suspended) {
      if (active && suspended) resumingRef.current = true;
      return;
    }
    const resuming = resumingRef.current;
    resumingRef.current = false;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getItems = () => {
      const root = containerRef.current;
      if (!root) return [] as HTMLElement[];
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    };

    // Move focus into the modal so screen readers and keyboards start inside it.
    const raf = requestAnimationFrame(() => {
      if (resuming) return;
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) return;
      const [first] = getItems();
      (first ?? root).focus?.();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const root = containerRef.current;
      if (!root) return;
      if (event.key === "Escape" && closeOnEscape) {
        event.stopPropagation();
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getItems();
      if (items.length === 0) {
        event.preventDefault();
        root.focus?.();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !root.contains(activeEl)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    // Rotasi layar (portrait/landscape) sering membuat browser/WebView
    // membuang fokus ke <body> atau ke elemen di luar modal. Setelah layout
    // stabil, fokus dikembalikan ke elemen terakhir di dalam modal.
    let lastInside: HTMLElement | null = null;
    const onFocusIn = (event: FocusEvent) => {
      const root = containerRef.current;
      const target = event.target as HTMLElement | null;
      if (root && target && root.contains(target)) lastInside = target;
    };
    document.addEventListener("focusin", onFocusIn, true);

    let rotateTimer: ReturnType<typeof setTimeout> | undefined;
    const reapplyFocus = () => {
      if (rotateTimer) clearTimeout(rotateTimer);
      rotateTimer = setTimeout(() => {
        const root = containerRef.current;
        if (!root || suspendedRef.current) return;
        const activeEl = document.activeElement as HTMLElement | null;
        if (activeEl && activeEl !== document.body && root.contains(activeEl)) return;
        // Fokus sudah dipindahkan pengguna ke luar modal secara sadar? Jangan ganggu.
        if (activeEl && activeEl !== document.body && !root.contains(activeEl)) return;
        const items = getItems();
        const target =
          lastInside && document.contains(lastInside) && root.contains(lastInside)
            ? lastInside
            : (items[0] ?? root);
        target.focus?.();
      }, 120);
    };
    const orientation = typeof screen !== "undefined" ? screen.orientation : undefined;
    orientation?.addEventListener?.("change", reapplyFocus);
    window.addEventListener("orientationchange", reapplyFocus);
    window.addEventListener("resize", reapplyFocus);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      if (rotateTimer) clearTimeout(rotateTimer);
      orientation?.removeEventListener?.("change", reapplyFocus);
      window.removeEventListener("orientationchange", reapplyFocus);
      window.removeEventListener("resize", reapplyFocus);
      // Jeda sementara: jangan sentuh fokus sama sekali.
      if (suspendedRef.current) return;
      restoreFocus(previouslyFocused, containerRef.current, fallbackRef.current);
    };
  }, [active, suspended, closeOnEscape]);

  return containerRef;
}

/**
 * Kembalikan fokus ke pemicu saat modal menutup — apa pun penyebabnya
 * (aksi pengguna, timeout, atau perubahan status dari server).
 *
 * Urutan: elemen pemicu bila masih ada dan bisa difokuskan → sasaran cadangan
 * → <main> yang dibuat fokusable sementara. Fokus tidak dipindahkan bila
 * pengguna sudah berpindah sendiri ke elemen lain di luar modal.
 */
function restoreFocus(
  previous: HTMLElement | null,
  container: HTMLElement | null,
  fallback?: (() => HTMLElement | null) | undefined,
) {
  const active = document.activeElement as HTMLElement | null;
  const focusOutside =
    active && active !== document.body && !(container && container.contains(active));
  if (focusOutside) return;

  const usable = (el: HTMLElement | null | undefined): el is HTMLElement =>
    Boolean(
      el &&
      el !== document.body &&
      el !== document.documentElement &&
      document.contains(el) &&
      !(el as HTMLButtonElement).disabled,
    );

  if (usable(previous)) {
    previous.focus?.();
    if (document.activeElement === previous) return;
  }
  const alt = fallback?.() ?? null;
  if (usable(alt)) {
    alt.focus?.();
    if (document.activeElement === alt) return;
  }
  const main = document.querySelector("main") as HTMLElement | null;
  if (!main) return;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  }
  main.focus?.();
}
