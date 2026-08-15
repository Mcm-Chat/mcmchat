import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getActiveUserId, onAccountSwitch, scopedKey } from "@/lib/session-scope";

/**
 * Preferensi "Kurangi Animasi".
 * - "auto"  : ikuti setelan sistem (prefers-reduced-motion).
 * - "on"    : selalu matikan animasi non-kritis.
 * - "off"   : selalu tampilkan animasi.
 *
 * Disimpan per akun (`mcm:<userId>:reduce-motion`); key global hanya dipakai
 * skrip pra-hidrasi agar tidak ada kedip animasi saat memuat halaman.
 */
export type MotionPreference = "auto" | "on" | "off";

const LAST_KEY = "mcm:last-reduce-motion";

export const MOTION_BOOTSTRAP_SCRIPT = `(function(){try{var p=localStorage.getItem("${LAST_KEY}")||"auto";var sys=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;var on=p==="on"||(p!=="off"&&sys);document.documentElement.classList.toggle("reduce-motion",on);}catch(e){}})();`;

type MotionContextValue = {
  preference: MotionPreference;
  reduced: boolean;
  setPreference: (next: MotionPreference) => void;
};

const MotionContext = createContext<MotionContextValue | null>(null);

function systemPrefersReduced(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function resolve(preference: MotionPreference): boolean {
  if (preference === "on") return true;
  if (preference === "off") return false;
  return systemPrefersReduced();
}

function apply(reduced: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("reduce-motion", reduced);
}

function readStored(userId: string | null): MotionPreference {
  try {
    const value = localStorage.getItem(scopedKey("reduce-motion", userId));
    if (value === "on" || value === "off" || value === "auto") return value;
  } catch {
    /* storage tidak tersedia */
  }
  return "auto";
}

/** Satu-satunya pihak yang menerapkan class `reduce-motion` ke <html>. */
export function ReduceMotionProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<MotionPreference>("auto");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const load = (userId: string | null) => {
      const next = readStored(userId);
      setPreferenceState(next);
      const value = resolve(next);
      setReduced(value);
      apply(value);
    };
    load(getActiveUserId());
    return onAccountSwitch((next) => load(next));
  }, []);

  // Mode "auto" harus ikut berubah saat setelan sistem berubah.
  useEffect(() => {
    if (preference !== "auto" || typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setReduced(media.matches);
      apply(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: MotionPreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(scopedKey("reduce-motion"), next);
      localStorage.setItem(LAST_KEY, next);
    } catch {
      /* storage tidak tersedia */
    }
    const value = resolve(next);
    setReduced(value);
    apply(value);
  }, []);

  const value = useMemo(
    () => ({ preference, reduced, setPreference }),
    [preference, reduced, setPreference],
  );
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useReduceMotion(): MotionContextValue {
  const ctx = useContext(MotionContext);
  if (!ctx) throw new Error("useReduceMotion harus dipakai di dalam ReduceMotionProvider");
  return ctx;
}