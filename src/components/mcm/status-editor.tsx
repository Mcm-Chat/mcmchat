import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Eraser,
  FlipHorizontal,
  Gauge,
  Highlighter,
  Pencil,
  Redo2,
  RotateCw,
  Smile,
  SquareDashedBottom,
  Type,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CANVAS_H, CANVAS_W, createSceneCache, drawScene } from "@/lib/status/compose";
import {
  FpsMeter,
  frameInterval,
  pointSpacing,
  previewSize,
  type PerfMode,
} from "@/lib/status/perf";
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
const EMOJIS = ["😀", "😍", "🔥", "💯", "🎉", "📦", "🛒", "⭐"];

type Tool = "none" | "pen" | "highlight" | "pixelate" | "text" | "sticker";

/**
 * Editor status: filter, penyetelan, putar/cermin, coretan (pena, stabilo,
 * sensor), teks, dan stiker. Semua digambar ke kanvas 1080x1920 yang sama
 * dengan hasil ekspor sehingga pratinjau = hasil akhir.
 */
export function StatusEditor({
  image,
  onStateChange,
}: {
  image: HTMLImageElement;
  onStateChange: (state: EditorState) => void;
}) {
  const [state, dispatch] = useReducer(editorReducer, initialEditor);
  const [tool, setTool] = useState<Tool>("none");
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(18);
  const [text, setText] = useState("");
  const [perf, setPerf] = useState<PerfMode>("performance");
  const [fps, setFps] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingId = useRef<string | null>(null);
  const dragId = useRef<string | null>(null);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const cacheRef = useRef(createSceneCache());
  const frameRef = useRef<number | null>(null);
  const lastFrameAt = useRef(0);
  const fpsMeter = useRef(new FpsMeter());
  const perfRef = useRef(perf);
  perfRef.current = perf;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Satu penggambaran ulang per frame (requestAnimationFrame), dengan throttle
  // tambahan pada mode performa. Tanpa ini setiap gerakan jari memicu render
  // 1080x1920 berkali-kali dan pratinjau tersendat.
  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    const run = (now: number) => {
      frameRef.current = null;
      const gap = frameInterval(perfRef.current);
      if (gap && now - lastFrameAt.current < gap) {
        frameRef.current = requestAnimationFrame(run);
        return;
      }
      lastFrameAt.current = now;
      if (canvasRef.current)
        drawScene(canvasRef.current, image, stateRef.current, cacheRef.current);
      setFps(fpsMeter.current.tick(now));
    };
    frameRef.current = requestAnimationFrame(run);
  }, [image]);

  useEffect(() => {
    cacheRef.current = createSceneCache();
  }, [image]);

  // Ganti mode = ganti resolusi kanvas; gambar ulang segera.
  useEffect(() => {
    fpsMeter.current.reset();
    setFps(0);
    scheduleDraw();
  }, [perf, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
    onStateChange(state);
  }, [state, scheduleDraw, onStateChange]);

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
          l.type !== "stroke" && Math.hypot(l.x - x, l.y - y) < ("size" in l ? l.size * 1.6 : 60),
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
      // Titik terlalu rapat tidak menambah kualitas garis, hanya beban render.
      const prev = lastPoint.current;
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < pointSpacing(perf)) return;
      lastPoint.current = p;
      dispatch({ type: "appendPoint", id: drawingId.current, point: p });
    } else if (dragId.current)
      dispatch({
        type: "updateLive",
        id: dragId.current,
        patch: { x: p.x, y: p.y } as Partial<Layer>,
      });
  };

  const onUp = () => {
    drawingId.current = null;
    dragId.current = null;
    lastPoint.current = null;
  };

  return (
    <div className="space-y-3">
      <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-black">
        <canvas
          ref={canvasRef}
          width={previewSize(perf, CANVAS_W, CANVAS_H).width}
          height={previewSize(perf, CANVAS_W, CANVAS_H).height}
          className="w-full touch-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white tabular-nums">
          {fps > 0 ? `${fps} FPS` : "— FPS"}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
        <Label htmlFor="status-perf" className="flex items-center gap-2 text-sm">
          <Gauge className="size-4" /> Mode performa
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {perf === "performance" ? "Pratinjau ringan" : "Pratinjau penuh"}
          </span>
          <Switch
            id="status-perf"
            checked={perf === "performance"}
            onCheckedChange={(v) => setPerf(v ? "performance" : "quality")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton
          active={tool === "pen"}
          onClick={() => setTool(tool === "pen" ? "none" : "pen")}
          icon={<Pencil className="size-4" />}
          label="Pena"
        />
        <ToolButton
          active={tool === "highlight"}
          onClick={() => setTool(tool === "highlight" ? "none" : "highlight")}
          icon={<Highlighter className="size-4" />}
          label="Stabilo"
        />
        <ToolButton
          active={tool === "pixelate"}
          onClick={() => setTool(tool === "pixelate" ? "none" : "pixelate")}
          icon={<SquareDashedBottom className="size-4" />}
          label="Sensor"
        />
        <ToolButton
          active={tool === "text"}
          onClick={() => setTool(tool === "text" ? "none" : "text")}
          icon={<Type className="size-4" />}
          label="Teks"
        />
        <ToolButton
          active={tool === "sticker"}
          onClick={() => setTool(tool === "sticker" ? "none" : "sticker")}
          icon={<Smile className="size-4" />}
          label="Stiker"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "rotate" })}
        >
          <RotateCw className="size-4" /> Putar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: "flip" })}
        >
          <FlipHorizontal className="size-4" /> Cermin
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canUndo(state)}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canRedo(state)}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Redo2 className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => dispatch({ type: "reset" })}>
          <Eraser className="size-4" /> Reset
        </Button>
      </div>

      {tool === "text" && (
        <div className="space-y-1.5">
          <Label htmlFor="status-text">Ketik teks, lalu ketuk posisi pada foto</Label>
          <Input
            id="status-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tulis sesuatu…"
          />
        </div>
      )}

      {tool === "sticker" && (
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-xl border border-border px-2.5 py-1.5 text-xl"
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
          <p className="w-full text-xs text-muted-foreground">
            Geser stiker/teks langsung di atas foto untuk memindahkan.
          </p>
        </div>
      )}

      {(tool === "pen" || tool === "highlight" || tool === "pixelate" || tool === "text") && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Warna ${c}`}
                className={cn(
                  "size-7 rounded-full border-2",
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

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            type="button"
            size="sm"
            variant={state.filter === f.id ? "default" : "outline"}
            onClick={() => dispatch({ type: "filter", filter: f.id })}
          >
            {f.label}
          </Button>
        ))}
      </div>

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
    <Button type="button" size="sm" variant={active ? "default" : "outline"} onClick={onClick}>
      {icon} {label}
    </Button>
  );
}
