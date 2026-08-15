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
}) {
  const { onClose, active = true, closeOnEscape = true, fallbackFocus } = options;
  const containerRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  useEffect(() => {
    if (!active) return;
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
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown, true);
      restoreFocus(previouslyFocused, containerRef.current, fallbackRef.current);
    };
  }, [active, closeOnEscape]);

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
    Boolean(el && document.contains(el) && !(el as HTMLButtonElement).disabled);

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
