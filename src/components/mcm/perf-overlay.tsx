import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { isPerfOverlayEnabled } from "@/lib/debug/perf-flag";

type Sample = {
  fps: number;
  worstFrame: number;
  heapMB: number | null;
  heapLimitMB: number | null;
};

type MemoryInfo = { usedJSHeapSize: number; jsHeapSizeLimit: number };

const readMemory = (): MemoryInfo | null => {
  const mem = (performance as Performance & { memory?: MemoryInfo }).memory;
  return mem && typeof mem.usedJSHeapSize === "number" ? mem : null;
};

/**
 * Panel kecil berisi FPS, frame terburuk (indikasi lag), memori heap, dan
 * durasi render rute terakhir. Hanya dirender saat mode debug menyala.
 */
function PerfPanel() {
  const [sample, setSample] = useState<Sample>({
    fps: 0,
    worstFrame: 0,
    heapMB: null,
    heapLimitMB: null,
  });
  const [collapsed, setCollapsed] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [routeMs, setRouteMs] = useState(0);
  const routeStart = useRef(performance.now());

  // Waktu render rute: dari perubahan path sampai frame pertama setelahnya.
  useEffect(() => {
    routeStart.current = performance.now();
    const raf = requestAnimationFrame(() => {
      setRouteMs(Math.round(performance.now() - routeStart.current));
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  useEffect(() => {
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let windowStart = last;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      frames += 1;
      if (delta > worst) worst = delta;
      if (now - windowStart >= 1000) {
        const mem = readMemory();
        setSample({
          fps: Math.round((frames * 1000) / (now - windowStart)),
          worstFrame: Math.round(worst),
          heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
          heapLimitMB: mem ? Math.round(mem.jsHeapSizeLimit / 1048576) : null,
        });
        frames = 0;
        worst = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tone =
    sample.fps >= 50 ? "text-success" : sample.fps >= 30 ? "text-warning" : "text-destructive";

  return (
    <div
      role="status"
      aria-live="off"
      aria-label="Indikator performa mode debug"
      className="pointer-events-auto fixed top-2 left-2 z-[120] rounded-lg bg-media-canvas/75 px-2 py-1 font-mono text-[10px] leading-tight text-on-dark shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2"
        aria-expanded={!collapsed}
      >
        <span className={tone}>{sample.fps} fps</span>
        <span className="opacity-60">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <dl className="mt-1 space-y-0.5">
          <div className="flex gap-2">
            <dt className="opacity-60">frame max</dt>
            <dd className={sample.worstFrame > 50 ? "text-warning" : ""}>
              {sample.worstFrame} ms
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="opacity-60">render rute</dt>
            <dd>{routeMs} ms</dd>
          </div>
          <div className="flex gap-2">
            <dt className="opacity-60">memori</dt>
            <dd>{sample.heapMB === null ? "n/a" : `${sample.heapMB}/${sample.heapLimitMB} MB`}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="opacity-60">rute</dt>
            <dd className="max-w-[140px] truncate">{pathname}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export function PerfOverlay() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => setEnabled(isPerfOverlayEnabled()), []);
  if (!enabled) return null;
  return <PerfPanel />;
}
