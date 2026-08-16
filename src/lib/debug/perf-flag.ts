/**
 * Indikator performa hanya untuk mode debug — tidak pernah aktif untuk
 * pengguna biasa. Aktifkan dengan menambahkan `?debugPerf=1` pada URL
 * (tersimpan di perangkat ini), matikan dengan `?debugPerf=0`.
 */
const KEY = "mcm:debug-perf";

export function readPerfFlagFromSearch(search: string): boolean | null {
  const value = new URLSearchParams(search).get("debugPerf");
  if (value === null) return null;
  return value === "1" || value === "true";
}

export function isPerfOverlayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const fromUrl = readPerfFlagFromSearch(window.location.search);
    if (fromUrl !== null) {
      if (fromUrl) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
      return fromUrl;
    }
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
