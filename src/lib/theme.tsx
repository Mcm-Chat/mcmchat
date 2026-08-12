import { useCallback, useEffect, useState } from "react";

const KEY = "mcm-theme";
export type Theme = "light" | "dark";

/** Preferensi tema disimpan di localStorage — satu-satunya data lokal non-sensitif. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
    setThemeState(stored);
    document.documentElement.classList.toggle("dark", stored === "dark");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  return { theme, setTheme };
}
