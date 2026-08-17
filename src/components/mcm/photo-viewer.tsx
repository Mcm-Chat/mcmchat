import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

/**
 * Lightbox foto layar penuh.
 *
 * Bubble di chat tetap ringkas; detail dilihat di sini: ketuk dua kali atau
 * cubit untuk zoom (titik yang disentuh tetap di tempat), seret untuk menggeser,
 * roda/pinch trackpad untuk zoom halus, dan Esc / ketuk latar untuk menutup.
 */
export function PhotoViewer({
  url,
  caption,
  onClose,
}: {
  url: string;
  caption?: string | null;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  // State terbaru untuk listener wheel non-passive yang dipasang sekali.
  const view = useRef({ scale: 1, offset: { x: 0, y: 0 } });
  view.current = { scale, offset };

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  /** Titik kursor relatif pusat panggung (transform-origin gambar = tengah). */
  const anchorOf = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  /** Zoom ke `next` sambil menahan titik `anchor` tetap di posisi layarnya. */
  const zoomAt = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const cur = view.current;
    const clamped = clampScale(next);
    if (clamped === cur.scale) return;
    if (clamped === MIN_SCALE) {
      setScale(MIN_SCALE);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const a = anchor ?? { x: 0, y: 0 };
    const k = clamped / cur.scale;
    setScale(clamped);
    setOffset({ x: a.x - (a.x - cur.offset.x) * k, y: a.y - (a.y - cur.offset.y) * k });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoomAt(view.current.scale * 1.4);
      if (e.key === "-" || e.key === "_") zoomAt(view.current.scale / 1.4);
      if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, reset, zoomAt]);

  // Roda mouse + pinch trackpad (wheel + ctrlKey) butuh listener non-passive.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const intensity = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(view.current.scale * Math.exp(-dy * intensity), anchorOf(e.clientX, e.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [anchorOf, zoomAt]);

  const distanceOf = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const midpointOf = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return anchorOf((a.x + b.x) / 2, (a.y + b.y) / 2);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drag.current = null;
      setDragging(false);
      pinch.current = { dist: distanceOf(), scale };
      return;
    }
    if (scale > 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      setDragging(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && pointers.current.size === 2) {
      const dist = distanceOf();
      if (p.dist > 0 && dist > 0) zoomAt((p.scale * dist) / p.dist, midpointOf());
      return;
    }
    const d = drag.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
    setDragging(false);
  };

  /** Ketuk: dua kali = zoom di titik ketukan; sekali di latar saat 1× = tutup. */
  const handleTap = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      zoomAt(scale > 1 ? MIN_SCALE : 2.5, anchorOf(e.clientX, e.clientY));
      return;
    }
    lastTap.current = now;
    if (scale === 1 && e.target === e.currentTarget) {
      window.setTimeout(() => {
        if (lastTap.current === now) onClose();
      }, 280);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pratinjau foto"
      className="fixed inset-0 z-[100] flex flex-col bg-background/98 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup pratinjau foto"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <X className="size-6" />
        </button>
        <div className="flex items-center gap-1">
          <span
            aria-live="polite"
            className="mr-1 min-w-11 rounded-full bg-muted/70 px-2 py-1 text-center text-[11px] font-semibold tabular-nums text-muted-foreground"
          >
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomAt(scale / 1.4)}
            aria-label="Perkecil"
            disabled={scale <= MIN_SCALE}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted disabled:opacity-40"
          >
            <ZoomOut className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => zoomAt(scale * 1.4)}
            aria-label="Perbesar"
            disabled={scale >= MAX_SCALE}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted disabled:opacity-40"
          >
            <ZoomIn className="size-5" />
          </button>
          <a
            href={url}
            download
            target="_blank"
            rel="noreferrer"
            aria-label="Unduh foto"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <Download className="size-5" />
          </a>
        </div>
      </div>

      <div
        ref={stageRef}
        className={cn(
          "flex flex-1 touch-none items-center justify-center overflow-hidden",
          scale > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
        )}
        onClick={handleTap}
        onDoubleClick={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <img
          src={url}
          alt={caption || "Foto"}
          decoding="async"
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging || pinch.current ? "none" : "transform 160ms ease-out",
          }}
        />
      </div>

      {caption ? (
        <p className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-[13px] break-words text-muted-foreground">
          {caption}
        </p>
      ) : (
        <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />
      )}
    </div>
  );
}
