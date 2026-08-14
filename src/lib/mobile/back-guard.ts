/**
 * Tombol Back Android (WebView) menutup overlay lebih dulu, bukan langsung
 * meninggalkan halaman.
 *
 * Implementasi tanpa plugin tambahan: saat overlay terbuka, satu entri history
 * "penanda" didorong. Back berikutnya memicu `popstate` yang menutup overlay,
 * bukan berpindah route. Saat overlay ditutup lewat UI, entri penanda dibuang
 * kembali agar tidak menumpuk (tidak ada history loop).
 */
import { useEffect, useRef } from "react";

export const BACK_GUARD_KEY = "__mcmOverlay";

export function isGuardState(state: unknown): boolean {
  return !!state && typeof state === "object" && (state as Record<string, unknown>)[BACK_GUARD_KEY] === true;
}

export function useBackDismiss(open: boolean, onDismiss: () => void): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    let armed = true;
    window.history.pushState({ [BACK_GUARD_KEY]: true }, "");

    const onPop = () => {
      if (!armed) return;
      armed = false; // entri penanda sudah dikonsumsi oleh Back.
      dismiss.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Ditutup lewat UI: buang entri penanda agar Back berikutnya normal.
      if (armed && isGuardState(window.history.state)) window.history.back();
    };
  }, [open]);
}
