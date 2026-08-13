import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Check,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  Redo2,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ConfirmDialog } from "@/components/mcm/primitives";
import { cn } from "@/lib/utils";
import {
  ASPECT_RATIO,
  FILTERS,
  canRedo,
  canUndo,
  centeredCrop,
  historyReducer,
  initHistory,
  isDirty,
  type AspectPreset,
  type EditorState,
} from "@/lib/media/image-editor";
import { loadImage, renderFinalBlob, renderToCanvas, type LoadedImage } from "@/lib/media/image-pipeline";
import { validateImageFile } from "@/lib/media/image-validate";

const PRESETS: { id: AspectPreset; label: string }[] = [
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "original", label: "Original" },
  { id: "free", label: "Bebas" },
];

/**
 * Editor foto profil fullscreen.
 *
 * Foto sumber TIDAK PERNAH diunggah. Hanya hasil render final yang dikirim
 * lewat `onApply`, dan hanya saat pengguna menekan “Pasang foto profil”.
 */
export function AvatarEditor({
  file,
  onCancel,
  onApply,
}: {
  file: File;
  onCancel: () => void;
  onApply: (blob: Blob) => Promise<void>;
}) {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => initHistory());
  const state: EditorState = history.present;
  const [img, setImg] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    let disposed = false;
    let loaded: LoadedImage | null = null;
    void (async () => {
      const check = await validateImageFile(file);
      if (!check.ok) {
        setError(check.error);
        return;
      }
      try {
        loaded = await loadImage(file);
        if (disposed) {
          loaded.dispose();
          return;
        }
        setImg(loaded);
      } catch {
        setError("Foto tidak dapat dibaca di perangkat ini.");
      }
    })();
    return () => {
      disposed = true;
      loaded?.dispose();
    };
  }, [file]);

  // render preview ke DOM setiap state berubah
  useEffect(() => {
    const host = previewRef.current;
    if (!host || !img) return;
    const canvas = renderToCanvas(img, showBefore ? initHistory().present : state);
    canvas.className = "max-h-[42vh] w-auto rounded-2xl object-contain";
    host.replaceChildren(canvas);
    return () => {
      canvas.width = 0;
      canvas.height = 0;
      host.replaceChildren();
    };
  }, [img, state, showBefore]);

  const dirty = useMemo(() => isDirty(history), [history]);

  const close = () => (dirty ? setConfirmClose(true) : onCancel());

  const apply = async () => {
    if (!img || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const blob = await renderFinalBlob(img, state);
      await onApply(blob);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memasang foto profil");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Batal">
          <X className="size-5" />
        </Button>
        <span className="text-sm font-semibold">Edit foto profil</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo(history)} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo(history)} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 className="size-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-32 pt-3">
        {error ? (
          <p className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</p>
        ) : !img ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex justify-center" ref={previewRef} />

            <div className="mt-4 flex items-center justify-center gap-3">
              <PreviewChip label="Bulat" round img={previewRef} />
              <PreviewChip label="Kotak" img={previewRef} />
              <Button
                variant="outline"
                size="sm"
                onPointerDown={() => setShowBefore(true)}
                onPointerUp={() => setShowBefore(false)}
                onPointerLeave={() => setShowBefore(false)}
              >
                Tahan: sebelum
              </Button>
            </div>

            <Section title="Rasio">
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={state.preset === p.id ? "default" : "outline"}
                    onClick={() => {
                      dispatch({ type: "preset", preset: p.id });
                      if (ASPECT_RATIO[p.id]) dispatch({ type: "crop", crop: centeredCrop(p.id, img.width, img.height) });
                      else dispatch({ type: "crop", crop: { x: 0, y: 0, w: 1, h: 1 } });
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </Section>

            <Section title="Transformasi">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => dispatch({ type: "rotate" })}>
                  <RotateCw className="mr-1 size-4" /> 90°
                </Button>
                <Button size="sm" variant={state.flipH ? "default" : "outline"} onClick={() => dispatch({ type: "flip", axis: "h" })}>
                  <FlipHorizontal className="mr-1 size-4" /> Horizontal
                </Button>
                <Button size="sm" variant={state.flipV ? "default" : "outline"} onClick={() => dispatch({ type: "flip", axis: "v" })}>
                  <FlipVertical className="mr-1 size-4" /> Vertikal
                </Button>
              </div>
              <LabeledSlider label="Zoom" value={state.zoom * 100} min={100} max={400} onChange={(v) => dispatch({ type: "zoom", zoom: v / 100 })} />
              <LabeledSlider label="Posisi horizontal" value={state.crop.x * 100} min={0} max={Math.max(0, (1 - state.crop.w) * 100)} onChange={(v) => dispatch({ type: "crop", crop: { ...state.crop, x: v / 100 } })} />
              <LabeledSlider label="Posisi vertikal" value={state.crop.y * 100} min={0} max={Math.max(0, (1 - state.crop.h) * 100)} onChange={(v) => dispatch({ type: "crop", crop: { ...state.crop, y: v / 100 } })} />
            </Section>

            <Section title="Warna">
              <LabeledSlider label="Kecerahan" value={state.brightness} min={40} max={160} onChange={(v) => dispatch({ type: "adjust", key: "brightness", value: v })} />
              <LabeledSlider label="Kontras" value={state.contrast} min={40} max={160} onChange={(v) => dispatch({ type: "adjust", key: "contrast", value: v })} />
              <LabeledSlider label="Saturasi" value={state.saturation} min={0} max={200} onChange={(v) => dispatch({ type: "adjust", key: "saturation", value: v })} />
              <div className="mt-2 flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <Button key={f.id} size="sm" variant={state.filter === f.id ? "default" : "outline"} onClick={() => dispatch({ type: "filter", filter: f.id })}>
                    {f.label}
                  </Button>
                ))}
              </div>
            </Section>

            <Section title="Sensor area">
              <p className="mb-2 text-xs text-muted-foreground">
                Tambahkan area blur atau pixelate pada bagian sensitif. Area dihitung dari tengah foto dan bisa dihapus kembali.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => dispatch({ type: "mask.add", mask: { id: crypto.randomUUID(), kind: "blur", x: 0.3, y: 0.3, w: 0.4, h: 0.25 } })}>
                  + Blur
                </Button>
                <Button size="sm" variant="outline" onClick={() => dispatch({ type: "mask.add", mask: { id: crypto.randomUUID(), kind: "pixelate", x: 0.3, y: 0.3, w: 0.4, h: 0.25 } })}>
                  + Pixelate
                </Button>
                {state.masks.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "mask.clear" })}>
                    <Trash2 className="mr-1 size-4" /> Hapus {state.masks.length} area
                  </Button>
                )}
              </div>
            </Section>

            <Section title="Latar (bila rasio tidak penuh)">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={state.background === "blur" ? "default" : "outline"} onClick={() => dispatch({ type: "background", mode: "blur" })}>
                  Blur
                </Button>
                <Button size="sm" variant={state.background === "color" ? "default" : "outline"} onClick={() => dispatch({ type: "background", mode: "color" })}>
                  Warna polos
                </Button>
                {state.background === "color" && (
                  <input
                    type="color"
                    aria-label="Warna latar"
                    value={state.backgroundColor}
                    onChange={(e) => dispatch({ type: "background", mode: "color", color: e.target.value })}
                    className="h-9 w-12 rounded-md border border-border bg-transparent"
                  />
                )}
              </div>
            </Section>

            <Button variant="ghost" size="sm" className="mt-4" onClick={() => dispatch({ type: "reset" })} disabled={!dirty}>
              Reset semua perubahan
            </Button>
          </>
        )}
      </div>

      <footer className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          <Button variant="outline" className="flex-1" onClick={close} disabled={busy}>
            Batal
          </Button>
          <Button className="flex-1" onClick={apply} disabled={!img || busy || !!error}>
            {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Check className="mr-1 size-4" />}
            Pasang foto profil
          </Button>
        </div>
      </footer>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Buang perubahan?"
        description="Draft foto profil belum dipasang dan akan dibuang."
        confirmLabel="Buang"
        onConfirm={onCancel}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function LabeledSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={Math.max(min + 1, max)} step={1} onValueChange={([v]) => onChange(v ?? value)} />
    </div>
  );
}

function PreviewChip({ label, round, img }: { label: string; round?: boolean; img: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const source = img.current?.querySelector("canvas");
    const target = ref.current;
    if (!source || !target) return;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0, target.width, target.height);
  });
  return (
    <div className="text-center">
      <canvas
        ref={ref}
        width={56}
        height={56}
        className={cn("size-14 border border-border object-cover", round ? "rounded-full" : "rounded-lg")}
      />
      <span className="mt-1 block text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}