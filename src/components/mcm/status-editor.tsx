import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Check,
  Eraser,
  FlipHorizontal,
  Highlighter,
  MoveUpRight,
  Pencil,
  Redo2,
  RotateCw,
  Smile,
  SlidersHorizontal,
  SquareDashedBottom,
  Sparkles,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useModalA11y } from "@/lib/a11y/use-modal-a11y";
import { CANVAS_H, CANVAS_W, createSceneCache, drawScene } from "@/lib/status/compose";
import { frameInterval, pointSpacing, previewSize, type PerfMode } from "@/lib/status/perf";
import { detectPerfMode } from "@/lib/status/load-image";
import {
  canRedo,
  canUndo,
  editorReducer,
  FILTERS,
  initialEditor,
  type EditorState,
  type Layer,
} from "@/lib/status/editor";

const COLORS = ["#ffffff", "#0f172a", "#ef4444", "#f59e0b", "#22c55e", "#0ea5e9", "#a855f7"];
const EMOJIS = ["😀", "😍", "🔥", "💯", "🎉", "📦", "🛒", "⭐", "➡️", "⬆️", "↗️", "✅"];

type Tool =
  "none" | "pen" | "highlight" | "pixelate" | "arrow" | "text" | "sticker" | "filter" | "adjust";

/**
 * Editor status layar penuh: filter, penyetelan, putar/cermin, coretan (pena,
 * stabilo, sensor), teks, dan stiker. Pratinjau digambar pada kanvas yang sama
 * dengan hasil ekspor sehingga apa yang terlihat = apa yang diunggah.
 */
export function StatusEditor({
  image,
  busy = false,
  onCancel,
  onDone,
}: {
  image: HTMLImageElement;
  busy?: boolean;
  onCancel: () => void;
  onDone: (state: EditorState, caption: string) => void;
}) {
  const [state, dispatch] = useReducer(editorReducer, initialEditor);
  const [tool, setTool] = useState<Tool>("none");
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(18);
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [perf] = useState<PerfMode>(() => detectPerfMode());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingId = useRef<string | null>(null);
  const arrowId = useRef<string | null>(null);
  const dragId = useRef<string | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const cacheRef = useRef(createSceneCache());
  const frameRef = useRef<number | null>(null);
  const lastFrameAt = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Satu penggambaran ulang per frame (requestAnimationFrame) dengan throttle
  // pada perangkat lambat: tanpa ini tiap gerakan jari memicu render berkali-kali.
  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    const run = (now: number) => {
      frameRef.current = null;
      const gap = frameInterval(perf);
      if (gap && now - lastFrameAt.current < gap) {
        frameRef.current = requestAnimationFrame(run);
        return;
      }
      lastFrameAt.current = now;
      if (canvasRef.current)
        drawScene(canvasRef.current, image, stateRef.current, cacheRef.current);
    };
    frameRef.current = requestAnimationFrame(run);
  }, [image, perf]);

  useEffect(() => {
    cacheRef.current = createSceneCache();
    // Sebagian WebView melaporkan gambar "load" sebelum benar-benar terdekode;
    // tanpa menunggu decode, kanvas hanya menampilkan latar gelap (layar hitam).
    if (image.naturalWidth === 0 && typeof image.decode === "function") {
      void image.decode().then(scheduleDraw).catch(scheduleDraw);
    }
    scheduleDraw();
  }, [image, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [state, scheduleDraw]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const toCanvas = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const hitLayer = (x: number, y: number): Layer | undefined =>
    [...state.layers]
      .reverse()
      .find(
        (l) =>
          (l.type === "text" || l.type === "sticker") &&
          Math.hypot(l.x - x, l.y - y) < l.size * 1.6,
      );

  const onDown = (e: React.PointerEvent) => {
    const p = toCanvas(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "pen" || tool === "highlight" || tool === "pixelate") {
      const id = crypto.randomUUID();
      drawingId.current = id;
      lastPoint.current = p;
      dispatch({
        type: "add",
        layer: {
          id,
          type: "stroke",
          tool,
          color,
          width: tool === "pixelate" ? width * 2 : width,
          points: [p],
        },
      });
      return;
    }
    if (tool === "arrow") {
      const id = crypto.randomUUID();
      arrowId.current = id;
      dispatch({
        type: "add",
        layer: {
          id,
          type: "arrow",
          x1: p.x,
          y1: p.y,
          x2: p.x + 1,
          y2: p.y + 1,
          color,
          width: Math.max(14, width * 1.6),
        },
      });
      return;
    }
    if (tool === "text" && text.trim()) {
      dispatch({
        type: "add",
        layer: {
          id: crypto.randomUUID(),
          type: "text",
          text: text.trim(),
          x: p.x,
          y: p.y,
          size: 56,
          color,
          bubble: true,
          font: "ui-sans-serif, system-ui, sans-serif",
        },
      });
      setText("");
      setTool("none");
      return;
    }
    const hit = hitLayer(p.x, p.y);
    if (hit) {
      dragId.current = hit.id;
      // Satu snapshot riwayat di awal geseran.
      dispatch({ type: "update", id: hit.id, patch: {} as Partial<Layer> });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toCanvas(e);
    if (drawingId.current) {
      const prev = lastPoint.current;
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < pointSpacing(perf)) return;
      lastPoint.current = p;
      dispatch({ type: "appendPoint", id: drawingId.current, point: p });
    } else if (arrowId.current)
      dispatch({
        type: "updateLive",
        id: arrowId.current,
        patch: { x2: p.x, y2: p.y } as Partial<Layer>,
      });
    else if (dragId.current)
      dispatch({
        type: "updateLive",
        id: dragId.current,
        patch: { x: p.x, y: p.y } as Partial<Layer>,
      });
  };

  const onUp = () => {
    drawingId.current = null;
    arrowId.current = null;
    dragId.current = null;
    lastPoint.current = null;
  };

  const modalRef = useModalA11y<HTMLDivElement>({ onClose: onCancel });
  const size = previewSize(perf, CANVAS_W, CANVAS_H);
  const toggle = (t: Tool) => setTool((cur) => (cur === t ? "none" : t));

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Editor status"
      tabIndex={-1}
      className="fixed inset-0 z-[70] flex flex-col bg-background outline-none"
    >
      <header className="flex items-center gap-1 border-b border-border px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Batal"
          onClick={onCancel}
        >
          <X className="size-5" />
        </Button>
        <p className="flex-1 truncate text-sm font-semibold">Edit status</p>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Putar 90 derajat"
          onClick={() => dispatch({ type: "rotate" })}
        >
          <RotateCw className="size-5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Cermin"
          onClick={() => dispatch({ type: "flip" })}
        >
          <FlipHorizontal className="size-5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Urungkan"
          disabled={!canUndo(state)}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Undo2 className="size-5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 rounded-xl"
          aria-label="Ulangi"
          disabled={!canRedo(state)}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Redo2 className="size-5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-media-canvas p-2">
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          className="h-auto max-h-full w-auto max-w-full touch-none rounded-xl"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>

      <div className="max-h-[42vh] space-y-2 overflow-y-auto border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-4 gap-1.5">
          <ToolButton
            active={tool === "pen"}
            onClick={() => toggle("pen")}
            icon={<Pencil className="size-4" />}
            label="Pena"
          />
          <ToolButton
            active={tool === "highlight"}
            onClick={() => toggle("highlight")}
            icon={<Highlighter className="size-4" />}
            label="Stabilo"
          />
          <ToolButton
            active={tool === "pixelate"}
            onClick={() => toggle("pixelate")}
            icon={<SquareDashedBottom className="size-4" />}
            label="Sensor"
          />
          <ToolButton
            active={tool === "arrow"}
            onClick={() => toggle("arrow")}
            icon={<MoveUpRight className="size-4" />}
            label="Panah 3D"
          />
          <ToolButton
            active={tool === "text"}
            onClick={() => toggle("text")}
            icon={<Type className="size-4" />}
            label="Teks"
          />
          <ToolButton
            active={tool === "sticker"}
            onClick={() => toggle("sticker")}
            icon={<Smile className="size-4" />}
            label="Stiker"
          />
          <ToolButton
            active={tool === "filter"}
            onClick={() => toggle("filter")}
            icon={<Sparkles className="size-4" />}
            label="Filter"
          />
        </div>

        {tool === "text" && (
          <div className="space-y-1.5">
            <Label htmlFor="status-text">Ketik teks, lalu ketuk posisi pada foto</Label>
            <Input
              id="status-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tulis sesuatu…"
              className="h-11 rounded-xl"
            />
          </div>
        )}

        {tool === "sticker" && (
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Stiker ${emoji}`}
                className="size-11 rounded-xl border border-border text-xl"
                onClick={() =>
                  dispatch({
                    type: "add",
                    layer: {
                      id: crypto.randomUUID(),
                      type: "sticker",
                      emoji,
                      x: CANVAS_W / 2,
                      y: CANVAS_H / 2,
                      size: 140,
                    },
                  })
                }
              >
                {emoji}
              </button>
            ))}
            <p className="w-full text-[11px] text-muted-foreground">
              Geser stiker/teks langsung di atas foto untuk memindahkan.
            </p>
          </div>
        )}

        {tool === "arrow" && (
          <p className="text-[11px] text-muted-foreground">
            Tarik jari dari pangkal ke ujung untuk membuat panah 3D bergradien.
          </p>
        )}

        {(tool === "pen" ||
          tool === "highlight" ||
          tool === "pixelate" ||
          tool === "arrow" ||
          tool === "text") && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Warna ${c}`}
                  className={cn(
                    "size-8 rounded-full border-2",
                    color === c ? "border-primary" : "border-border",
                  )}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Tebal</span>
              <Slider
                value={[width]}
                min={6}
                max={60}
                step={2}
                onValueChange={([v]) => setWidth(v ?? 18)}
                className="flex-1"
              />
            </div>
          </div>
        )}

        {tool === "filter" && (
          <div className="space-y-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  className="h-10 shrink-0 rounded-xl text-xs"
                  variant={state.filter === f.id ? "default" : "outline"}
                  onClick={() => dispatch({ type: "filter", filter: f.id })}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 rounded-xl text-xs"
              onClick={() => setTool("adjust")}
            >
              <SlidersHorizontal className="size-4" /> Penyetelan lanjutan
            </Button>
          </div>
        )}

        {tool === "adjust" && (
          <div className="grid gap-2">
            {(
              [
                ["Kecerahan", "brightness"],
                ["Kontras", "contrast"],
                ["Saturasi", "saturation"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-20 text-xs text-muted-foreground">{label}</span>
                <Slider
                  value={[state.adjust[key] * 100]}
                  min={50}
                  max={160}
                  step={2}
                  onValueChange={([v]) =>
                    dispatch({ type: "adjust", patch: { [key]: (v ?? 100) / 100 } })
                  }
                  className="flex-1"
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-10 rounded-xl text-xs"
              onClick={() => dispatch({ type: "reset" })}
            >
              <Eraser className="size-4" /> Reset semua editan
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="status-caption">Keterangan slide</Label>
          <Input
            id="status-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Opsional"
            className="h-11 rounded-xl"
          />
        </div>

        <Button
          type="button"
          className="h-12 w-full rounded-xl"
          disabled={busy}
          onClick={() => onDone(state, caption.trim())}
        >
          <Check className="size-4" /> Simpan slide
        </Button>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="h-14 flex-col gap-1 rounded-xl px-0 text-[10px]"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}
