/**
 * Tingkat perangkat + mode gulir.
 *
 * Sumber lag terbesar di ponsel kelas menengah bukan JavaScript, melainkan
 * compositing: `backdrop-filter` pada bilah lengket (composer, header hari,
 * navigasi bawah) memaksa GPU membaca ulang latar setiap frame saat daftar
 * digulir. Dua strategi di sini:
 *
 * 1. `data-perf="low"` — perangkat lemah (RAM/inti kecil, hemat data, jaringan
 *    lambat) mematikan blur & bayangan mahal secara permanen.
 * 2. `data-scrolling="1"` — semua perangkat mematikan blur selama jari
 *    menggulir, lalu memulihkannya begitu gulir berhenti.
 */

const TIER_ATTR = "data-perf";

/** Ditanam di <head> agar atribut sudah ada sebelum cat pertama. */
export const DEVICE_TIER_BOOTSTRAP_SCRIPT = `(function(){try{var n=navigator||{};var mem=n.deviceMemory||8;var cpu=n.hardwareConcurrency||8;var c=n.connection||{};var slow=c.saveData===true||/(^|-)2g$/.test(c.effectiveType||"");var low=mem<=4||cpu<=4||slow;document.documentElement.setAttribute("${TIER_ATTR}",low?"low":"high");}catch(e){}})();`;

export function isLowEndDevice(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute(TIER_ATTR) === "low";
}

/**
 * Menandai <html data-scrolling="1"> selama gulir (termasuk kontainer dalam,
 * karena listener dipasang pada fase capture) dan melepasnya 140ms setelah
 * gulir terakhir. Idle callback tidak dipakai supaya pemulihan terasa instan.
 */
export function installScrollPerf(): () => void {
  if (typeof window === "undefined") return () => {};
  const root = document.documentElement;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    active = false;
    root.removeAttribute("data-scrolling");
  };

  const onScroll = () => {
    if (!active) {
      active = true;
      root.setAttribute("data-scrolling", "1");
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(stop, 140);
  };

  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
    if (timer) clearTimeout(timer);
    stop();
  };
}
