import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getActiveUserId, onAccountSwitch, scopedKey } from "@/lib/session-scope";

/** Key global hanya menyimpan tema terakhir yang dipakai di perangkat ini
 *  (dipakai skrip pra-hidrasi agar tidak ada kedip). Preferensi sebenarnya
 *  disimpan per akun: `mcm:<userId>:theme`. */
const LAST_KEY = "mcm:last-theme";
export type Theme = "light" | "dark";

export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("${LAST_KEY}")==="light"?"light":"dark";document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.dataset.theme=t;}catch(e){}})();`;

type ThemeContextValue = { theme: Theme; setTheme: (next: Theme) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset["theme"] = theme;
}

function readStored(userId: string | null): Theme {
  try {
    const scoped = localStorage.getItem(scopedKey("theme", userId));
    if (scoped === "light" || scoped === "dark") return scoped;
  } catch {
    /* storage tidak tersedia */
  }
  return "dark";
}

/**
 * Satu-satunya pihak yang menerapkan class tema ke `document.documentElement`.
 * Route mana pun dilarang memutasi tema saat mount/unmount.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const load = (userId: string | null) => {
      const next = readStored(userId);
      setThemeState(next);
      apply(next);
    };
    load(getActiveUserId());
    // Pergantian akun memuat ulang preferensi akun baru; preferensi akun lama
    // sudah dihapus oleh purgeLocalScope sehingga tidak bocor antar akun.
    return onAccountSwitch((next) => load(next));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(scopedKey("theme"), next);
      localStorage.setItem(LAST_KEY, next);
    } catch {
      /* storage tidak tersedia */
    }
    apply(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme harus dipakai di dalam ThemeProvider");
  return ctx;
}
