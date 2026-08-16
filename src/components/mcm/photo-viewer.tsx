import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peninjau foto layar penuh.
 *
 * Dibuka saat foto di chat diketuk: ketuk dua kali untuk zoom, seret untuk
 * menggeser saat ter-zoom, dan tombol unduh untuk menyimpan gambar.
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
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastTap = useRef(0);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const zoomTo = (next: number) => {
    const clamped = Math.min(4, Math.max(1, next));
    setScale(clamped);
    if (clamped === 1) setOffset({ x: 0, y: 0 });
  };

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      zoomTo(scale > 1 ? 1 : 2.5);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
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
          <button
            type="button"
            onClick={() => zoomTo(scale - 0.5)}
            aria-label="Perkecil"
            disabled={scale <= 1}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted disabled:opacity-40"
          >
            <ZoomOut className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => zoomTo(scale + 0.5)}
            aria-label="Perbesar"
            disabled={scale >= 4}
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
        className="flex flex-1 items-center justify-center overflow-hidden touch-none"
        onClick={handleTap}
        onPointerDown={(e) => {
          if (scale <= 1) return;
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <img
          src={url}
          alt={caption || "Foto"}
          decoding="async"
          draggable={false}
          className={cn("max-h-full max-w-full select-none object-contain")}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: drag.current ? "none" : "transform 160ms ease-out",
          }}
        />
      </div>

      {caption ? (
        <p className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-[13px] break-words text-muted-foreground">
          {caption}
        </p>
      ) : (
        <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />
      )}
    </div>
  );
}
