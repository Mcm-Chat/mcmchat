import { useEffect, useReducer } from "react";
import { curtainReducer, INITIAL_CURTAIN } from "@/lib/security/screen-privacy";

/**
 * Privacy curtain MCM.
 *
 * Bukan pemblokir screenshot — itu mustahil dari web. Tugasnya menutup konten
 * saat aplikasi kehilangan fokus / masuk background sehingga pratinjau task
 * switcher browser tidak menampilkan isi chat.
 */
export function ScreenPrivacyGuard() {
  const [state, dispatch] = useReducer(curtainReducer, INITIAL_CURTAIN);

  useEffect(() => {
    const onVisibility = () =>
      dispatch({ type: document.visibilityState === "hidden" ? "hidden" : "visible" });
    const onBlur = () => dispatch({ type: "blur" });
    const onFocus = () => dispatch({ type: "focus" });
    const onPageHide = () => dispatch({ type: "pagehide" });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  // Lepas tirai hanya setelah frame pertama siap agar tidak ada kilatan konten.
  useEffect(() => {
    if (!state.pendingReveal) return;
    const raf = requestAnimationFrame(() => dispatch({ type: "frame-ready" }));
    return () => cancelAnimationFrame(raf);
  }, [state.pendingReveal]);

  if (!state.covered) return null;
  return (
    <div
      aria-hidden
      className="app-gradient fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 text-navy-foreground"
    >
      <span className="flex size-16 items-center justify-center rounded-2xl bg-on-dark-surface text-2xl font-extrabold tracking-tight">
        MCM
      </span>
      <p className="text-sm font-medium opacity-80">Konten disembunyikan</p>
    </div>
  );
}
