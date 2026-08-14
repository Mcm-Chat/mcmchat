import { useEffect, useRef, useState } from "react";
import {
  Crop,
  RotateCw,
  Type as TypeIcon,
  Undo2,
  X,
  Check,
  MoveUpRight,
  Smile,
  Columns2,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Ann =
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: "text"; x: number; y: number; text: string; color: string; size: number }
  | { kind: "sticker"; x: number; y: number; emoji: string; size: number };

type Rect = { x: number; y: number; w: number; h: number };

const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ffffff", "#111827"];
const STICKERS = ["✅", "⚠️", "📍", "🔥", "⭐", "❌", "👍", "📦"];

function drawArrow(ctx: CanvasRenderingContext2D, a: Extract<Ann, { kind: "arrow" }>, w: number) {
  const width = Math.max(3, w / 180);
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x1, a.y1);
  ctx.lineTo(a.x2, a.y2);
  ctx.stroke();
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const head = width * 4;
  ctx.beginPath();
  ctx.moveTo(a.x2, a.y2);
  ctx.lineTo(a.x2 - head * Math.cos(ang - Math.PI / 7), a.y2 - head * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(a.x2 - head * Math.cos(ang + Math.PI / 7), a.y2 - head * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function paint(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  anns: Ann[],
  dx: number,
  dy: number,
) {
  ctx.drawImage(img, -dx, -dy);
  for (const a of anns) {
    ctx.save();
    ctx.translate(-dx, -dy);
    if (a.kind === "arrow") drawArrow(ctx, a, img.width);
    else {
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      if (a.kind === "sticker") {
        ctx.font = `${a.size}px serif`;
        ctx.fillText(a.emoji, a.x, a.y);
      } else {
        ctx.font = `700 ${a.size}px system-ui, sans-serif`;
        ctx.lineWidth = Math.max(2, a.size / 8);
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(a.text, a.x, a.y);
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, a.x, a.y);
      }
    }
    ctx.restore();
  }
}

/** Bakar gambar + anotasi (opsional dipotong) menjadi kanvas baru. */
function bake(img: HTMLImageElement, anns: Ann[], crop: Rect | null) {
  const c = document.createElement("canvas");
  const r = crop ?? { x: 0, y: 0, w: img.width, h: img.height };
  c.width = Math.max(1, Math.round(r.w));
  c.height = Math.max(1, Math.round(r.h));
  const ctx = c.getContext("2d")!;
  paint(ctx, img, anns, r.x, r.y);
  return c;
}

function rotated(img: HTMLImageElement, anns: Ann[]) {
  const flat = bake(img, anns, null);
  const c = document.createElement("canvas");
  c.width = flat.height;
  c.height = flat.width;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(flat, -flat.width / 2, -flat.height / 2);
  return c;
}

type Tool = "arrow" | "crop" | "text" | "sticker";

/**
 * Editor foto nyata: potong, putar, panah, stiker, dan teks.
 * Hasilnya satu data URL JPEG siap unggah.
 */
export function PhotoEditorDialog({
  src,
  title = "Edit foto",
  onCancel,
  onDone,
}: {
  src: string;
  title?: string;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [baseUrl, setBaseUrl] = useState(src);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]!);
  const [emoji, setEmoji] = useState(STICKERS[0]!);
  const [text, setText] = useState("");
  const [crop, setCrop] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
  const [applied, setApplied] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [compare, setCompare] = useState<"side" | "after">("side");

  useEffect(() => {
    let alive = true;
    const el = new Image();
    el.onload = () => {
      if (alive) setImg(el);
    };
    el.src = baseUrl;
    return () => {
      alive = false;
    };
  }, [baseUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(ctx, img, anns, 0, 0);
    if (crop) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(2, img.width / 250);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.restore();
    }
  }, [img, anns, crop]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    const p = point(e);
    if (tool === "sticker") {
      setAnns((a) => [
        ...a,
        { kind: "sticker", x: p.x, y: p.y, emoji, size: Math.max(48, img.width / 8) },
      ]);
      return;
    }
    if (tool === "text") {
      if (text.trim() === "") return;
      setAnns((a) => [
        ...a,
        {
          kind: "text",
          x: p.x,
          y: p.y,
          text: text.trim(),
          color,
          size: Math.max(28, img.width / 16),
        },
      ]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(p);
    if (tool === "crop") setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
    else setAnns((a) => [...a, { kind: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color }]);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const p = point(e);
    if (tool === "crop") {
      setCrop({
        x: Math.min(dragging.x, p.x),
        y: Math.min(dragging.y, p.y),
        w: Math.abs(p.x - dragging.x),
        h: Math.abs(p.y - dragging.y),
      });
      return;
    }
    setAnns((a) => {
      const last = a[a.length - 1];
      if (!last || last.kind !== "arrow") return a;
      return [...a.slice(0, -1), { ...last, x2: p.x, y2: p.y }];
    });
  };

  const onUp = () => setDragging(null);

  const applyCrop = () => {
    if (!img || !crop || crop.w < 16 || crop.h < 16) return;
    setBaseUrl(bake(img, anns, crop).toDataURL("image/jpeg", 0.9));
    setApplied((n) => n + 1 + anns.length);
    setAnns([]);
    setCrop(null);
    setTool("arrow");
  };

  const rotate = () => {
    if (!img) return;
    setBaseUrl(rotated(img, anns).toDataURL("image/jpeg", 0.9));
    setApplied((n) => n + 1 + anns.length);
    setAnns([]);
    setCrop(null);
  };

  const cropReady = !!crop && crop.w > 16 && crop.h > 16;
  const pending = anns.length + (cropReady ? 1 : 0);
  const totalChanges = applied + pending;

  const render = () =>
    bake(img!, anns, cropReady ? crop : null).toDataURL("image/jpeg", 0.85);

  const openPreview = () => {
    if (!img) return;
    setPreview(render());
  };

  const tools: { id: Tool; label: string; icon: typeof Crop }[] = [
    { id: "crop", label: "Potong", icon: Crop },
    { id: "arrow", label: "Panah", icon: MoveUpRight },
    { id: "text", label: "Teks", icon: TypeIcon },
    { id: "sticker", label: "Stiker", icon: Smile },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button size="icon" variant="ghost" className="size-11 rounded-xl" onClick={onCancel} aria-label="Batal">
          <X className="size-5" />
        </Button>
        <p className="flex-1 truncate text-sm font-semibold">{title}</p>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Putar 90 derajat"
          onClick={rotate}
        >
          <RotateCw className="size-5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Urungkan"
          disabled={anns.length === 0}
          onClick={() => setAnns((a) => a.slice(0, -1))}
        >
          <Undo2 className="size-5" />
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-hidden bg-muted/40 p-2">
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full touch-none rounded-xl"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>

      <div className="space-y-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-4 gap-1.5">
          {tools.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={tool === t.id ? "default" : "outline"}
              className="h-11 rounded-xl text-[11px]"
              onClick={() => setTool(t.id)}
            >
              <t.icon className="size-4" /> {t.label}
            </Button>
          ))}
        </div>

        {tool === "crop" && (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[11px] text-muted-foreground">
              Geser di foto untuk menandai area, lalu terapkan.
            </p>
            <Button size="sm" className="h-10 rounded-xl text-xs" disabled={!crop} onClick={applyCrop}>
              Terapkan potong
            </Button>
          </div>
        )}

        {tool === "text" && (
          <Input
            value={text}
            maxLength={60}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ketik teks lalu ketuk foto"
            className="h-11 rounded-xl"
          />
        )}

        {tool === "sticker" && (
          <div className="flex flex-wrap gap-1.5">
            {STICKERS.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Stiker ${s}`}
                onClick={() => setEmoji(s)}
                className={cn(
                  "size-11 rounded-xl border text-xl",
                  emoji === s ? "border-primary bg-primary/10" : "border-border",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {(tool === "arrow" || tool === "text") && (
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Warna ${c}`}
                onClick={() => setColor(c)}
                style={{ background: c }}
                className={cn(
                  "size-9 rounded-full border-2",
                  color === c ? "border-primary" : "border-border",
                )}
              />
            ))}
          </div>
        )}

        <Button className="h-12 w-full rounded-xl" disabled={!img} onClick={save}>
          <Check className="size-4" /> Pakai foto ini
        </Button>
      </div>
    </div>
  );
}