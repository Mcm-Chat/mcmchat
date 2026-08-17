import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReduceMotion } from "@/lib/a11y/reduce-motion";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
const PAN_STEP = 48; // px geser per tekan panah saat gambar diperbesar
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const { reduced: reduceMotion } = useReduceMotion();
  const titleId = useId();
  const captionId = `${titleId}-caption`;
  const helpId = `${titleId}-help`;
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const pct = Math.round(scale * 100);
  // Teks yang diumumkan pembaca layar setiap level zoom berubah (termasuk saat
  // batas minimum/maksimum tercapai) agar status selalu terdengar.
  const [announcement, setAnnouncement] = useState("");
  const firstAnnounce = useRef(true);
  useEffect(() => {
    if (firstAnnounce.current) {
      firstAnnounce.current = false;
      return;
    }
    const limit =
      scale >= MAX_SCALE
        ? ", zoom maksimum"
        : scale <= MIN_SCALE
          ? ", ukuran asli"
          : "";
    // Spasi berselang agar pengumuman dengan teks sama tetap dibacakan ulang.
    const text = `Zoom ${pct} persen${limit}`;
    setAnnouncement((prev) => (prev.endsWith("\u00a0") ? text : `${text}\u00a0`));
  }, [pct, scale]);
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
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "+" || e.key === "=") zoomAt(view.current.scale * 1.4);
      if (e.key === "-" || e.key === "_") zoomAt(view.current.scale / 1.4);
      if (e.key === "0" || e.key === "Home") reset();
      // Panah menggeser gambar saat diperbesar (setara seret dengan mouse).
      if (view.current.scale > MIN_SCALE && e.key.startsWith("Arrow")) {
        const target = e.target as HTMLElement | null;
        const typing =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable;
        if (!typing) {
          e.preventDefault();
          const dx = e.key === "ArrowLeft" ? -PAN_STEP : e.key === "ArrowRight" ? PAN_STEP : 0;
          const dy = e.key === "ArrowUp" ? -PAN_STEP : e.key === "ArrowDown" ? PAN_STEP : 0;
          setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
        }
      }
      if (e.key === "Tab") {
        // Kurung fokus di dalam lightbox selama terbuka.
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) {
          e.preventDefault();
          return;
        }
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        const outside = !dialogRef.current?.contains(active);
        if (outside) {
          // Fokus sempat lepas (mis. diklik latar): tarik kembali ke dalam.
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    // Sembunyikan sisa halaman dari pembaca layar & tab selama lightbox terbuka.
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.contains(dialogRef.current)) continue;
      if (el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
      inerted.push(el);
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      for (const el of inerted) {
        el.removeAttribute("inert");
        el.removeAttribute("aria-hidden");
      }
      previouslyFocused?.focus?.();
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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      className="fixed inset-0 z-[100] flex flex-col bg-background/98 backdrop-blur-sm"
    >
      <h2 id={titleId} className="sr-only">
        {caption ? `Pratinjau foto: ${caption}` : "Pratinjau foto"}
      </h2>
      <p id={helpId} className="sr-only">
        Esc untuk menutup, tombol plus dan minus untuk memperbesar dan memperkecil, 0 untuk
        mengembalikan ukuran asli, tombol panah untuk menggeser saat gambar diperbesar. Setiap
        perubahan level zoom akan diumumkan.
      </p>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          ref={closeRef}
          onClick={onClose}
          aria-label="Tutup pratinjau foto"
          title="Tutup (Esc)"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-3 text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X className="size-6" />
          <span className="hidden text-sm font-medium sm:inline">Tutup</span>
        </button>
        <div className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="mr-1 min-w-11 rounded-full bg-muted/70 px-2 py-1 text-center text-[11px] font-semibold tabular-nums text-muted-foreground"
          >
            {pct}%
          </span>
          <button
            type="button"
            onClick={() => zoomAt(scale / 1.4)}
            aria-label={`Perkecil foto, zoom saat ini ${pct} persen`}
            title="Perkecil (−)"
            disabled={scale <= MIN_SCALE}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <ZoomOut className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => zoomAt(scale * 1.4)}
            aria-label={`Perbesar foto, zoom saat ini ${pct} persen`}
            title="Perbesar (+)"
            disabled={scale >= MAX_SCALE}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <ZoomIn className="size-5" />
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label={`Kembalikan zoom ke 100 persen, zoom saat ini ${pct} persen`}
            title="Ukuran asli (0 atau Home)"
            disabled={scale <= MIN_SCALE}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <RotateCcw className="size-5" />
          </button>
          <a
            href={url}
            download
            target="_blank"
            rel="noreferrer"
            aria-label="Unduh foto"
            title="Unduh foto"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Download className="size-5" />
          </a>
        </div>
      </div>

      <div
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-label={
          caption
            ? `Area foto: ${caption}. Enter untuk memperbesar atau mengembalikan ukuran.`
            : "Area foto. Enter untuk memperbesar atau mengembalikan ukuran."
        }
        className={cn(
          "flex flex-1 touch-none items-center justify-center overflow-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
          scale > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
        )}
        onClick={handleTap}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            zoomAt(view.current.scale > MIN_SCALE ? MIN_SCALE : 2.5);
          }
        }}
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
        <p
          id={captionId}
          className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-[13px] break-words text-muted-foreground"
        >
          {caption}
        </p>
      ) : (
        <div className="pb-[max(0.5rem,env(safe-area-inset-bottom))]" />
      )}
    </div>
  );
}
