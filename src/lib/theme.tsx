import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "mcm-theme";
export type Theme = "light" | "dark";

/** Skrip pra-hidrasi: memasang class tema sebelum paint agar tidak ada kedip. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}")==="light"?"light":"dark";document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.dataset.theme=t;}catch(e){}})();`;

type ThemeContextValue = { theme: Theme; setTheme: (next: Theme) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Satu-satunya tempat tema disimpan dan diterapkan ke DOM. Route tidak boleh
 * menyentuh `document.documentElement` — membuka halaman apa pun (termasuk
 * Profil) tidak mengubah tema.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    const next: Theme = stored === "light" ? "light" : "dark";
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset['theme'] = next;
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* penyimpanan lokal bisa diblokir; tema tetap berlaku untuk sesi ini */
    }
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset['theme'] = next;
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Hanya membaca/menulis melalui provider global; tidak pernah menyentuh DOM sendiri. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme harus dipakai di dalam ThemeProvider");
  return ctx;
}
