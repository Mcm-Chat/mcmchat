import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { createSticker, deleteSticker, listStickers, type StickerRow } from "@/lib/api/stickers";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import {
  defaultStickerEdit,
  loadStickerImage,
  renderSticker,
  stickerToBlob,
  type StickerEdit,
} from "@/lib/media/sticker";

const EMOJI_TAGS = ["😀", "😂", "😍", "👍", "🙏", "🔥", "🎉", "😭", "😎", "❤️"];

export function StickerThumb({
  sticker,
  onPick,
  onDelete,
}: {
  sticker: StickerRow;
  onPick: (s: StickerRow) => void;
  onDelete?: ((s: StickerRow) => void) | undefined;
}) {
  const url = useSignedUrl("stickers", sticker.path);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onPick(sticker)}
        className="flex aspect-square w-full items-center justify-center rounded-2xl border border-border bg-muted/40 p-1.5 transition-colors hover:bg-muted"
        aria-label={`Kirim stiker ${sticker.emoji}`}
      >
        {url ? (
          <img src={url} alt={`Stiker ${sticker.emoji}`} className="size-full object-contain" />
        ) : (
          <Loader2 className="size-4 animate-spin opacity-60" />
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(sticker)}
          aria-label="Hapus stiker"
          className="absolute -top-1.5 -right-1.5 flex size-7 items-center justify-center rounded-full border border-border bg-card text-destructive shadow-sm"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Editor stiker: pilih foto, atur skala, hapus latar, beri teks. */
export function StickerEditor({
  userId,
  onSaved,
  onCancel,
}: {
  userId: string;
  onSaved: (s: StickerRow) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [edit, setEdit] = useState<StickerEdit>(defaultStickerEdit);
  const [emoji, setEmoji] = useState("😀");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const host = previewRef.current;
    if (!host || !img) return;
    const rendered = renderSticker(img, edit);
    const ctx = host.getContext("2d");
    if (!ctx) return;
    host.width = rendered.width;
    host.height = rendered.height;
    ctx.clearRect(0, 0, host.width, host.height);
    ctx.drawImage(rendered, 0, 0);
  }, [img, edit]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImg(await loadStickerImage(file));
      setEdit(defaultStickerEdit);
    } catch {
      toast.error("Gambar tidak dapat dibaca");
    }
  };

  const save = async () => {
    if (!img) return;
    setSaving(true);
    try {
      const blob = await stickerToBlob(renderSticker(img, edit));
      const row = await createSticker(userId, blob, emoji);
      toast.success("Stiker disimpan");
      onSaved(row);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stiker gagal disimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 px-4 pb-6">
      <div className="flex items-center justify-center rounded-3xl border border-dashed border-border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-3">
        {img ? (
          <canvas ref={previewRef} className="size-52 max-w-full object-contain" />
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex size-52 flex-col items-center justify-center gap-2 text-muted-foreground"
          >
            <ImagePlus className="size-8" />
            <span className="text-xs">Pilih foto dari galeri atau kamera</span>
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="Pilih gambar stiker"
        onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {img && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Perbesar</Label>
            <Slider
              value={[edit.scale]}
              min={0.5}
              max={2.5}
              step={0.05}
              onValueChange={([v]) => setEdit((p) => ({ ...p, scale: v ?? 1 }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Geser mendatar</Label>
              <Slider
                value={[edit.offsetX]}
                min={-200}
                max={200}
                step={4}
                onValueChange={([v]) => setEdit((p) => ({ ...p, offsetX: v ?? 0 }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Geser tegak</Label>
              <Slider
                value={[edit.offsetY]}
                min={-200}
                max={200}
                step={4}
                onValueChange={([v]) => setEdit((p) => ({ ...p, offsetY: v ?? 0 }))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-2.5">
            <span className="text-sm">Hapus latar belakang</span>
            <Switch
              checked={edit.removeBackground}
              onCheckedChange={(v) => setEdit((p) => ({ ...p, removeBackground: v }))}
            />
          </div>
          {edit.removeBackground && (
            <div className="space-y-1.5">
              <Label className="text-xs">Ketelitian hapus latar</Label>
              <Slider
                value={[edit.tolerance]}
                min={5}
                max={70}
                step={1}
                onValueChange={([v]) => setEdit((p) => ({ ...p, tolerance: v ?? 24 }))}
              />
            </div>
          )}
          <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-2.5">
            <span className="text-sm">Garis tepi putih</span>
            <Switch
              checked={edit.outline}
              onCheckedChange={(v) => setEdit((p) => ({ ...p, outline: v }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="sticker-caption">
              Teks stiker (opsional)
            </Label>
            <Input
              id="sticker-caption"
              value={edit.caption}
              maxLength={24}
              placeholder="Mantap!"
              onChange={(e) => setEdit((p) => ({ ...p, caption: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Emoji terkait</Label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_TAGS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`flex size-10 items-center justify-center rounded-full border text-lg ${
                    emoji === e ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={onCancel}>
          Batal
        </Button>
        {img && (
          <Button
            variant="secondary"
            className="h-11 rounded-xl"
            onClick={() => fileRef.current?.click()}
          >
            Ganti foto
          </Button>
        )}
        <Button
          className="h-11 flex-1 rounded-xl"
          disabled={!img || saving}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Simpan stiker"}
        </Button>
      </div>
    </div>
  );
}

/** Panel stiker di composer chat: pustaka pribadi + tombol buat baru. */
export function StickerPickerSheet({
  open,
  onOpenChange,
  userId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  onPick: (sticker: StickerRow) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"list" | "create">("list");
  const { data, isLoading } = useQuery({
    queryKey: ["stickers", userId],
    queryFn: () => listStickers(userId),
    enabled: open && !!userId,
  });
  const stickers = useMemo(() => data ?? [], [data]);

  const del = useMutation({
    mutationFn: (s: StickerRow) => deleteSticker(s),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stickers", userId] });
      toast.success("Stiker dihapus");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Stiker gagal dihapus"),
  });

  useEffect(() => {
    if (!open) setMode("list");
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle>{mode === "create" ? "Buat stiker" : "Stiker saya"}</SheetTitle>
        </SheetHeader>
        {mode === "create" ? (
          <StickerEditor
            userId={userId}
            onCancel={() => setMode("list")}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ["stickers", userId] });
              setMode("list");
            }}
          />
        ) : (
          <div className="px-4 pb-6">
            <div className="grid grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => setMode("create")}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-primary"
              >
                <Plus className="size-5" />
                <span className="text-[10px] font-medium">Buat</span>
              </button>
              {stickers.map((s) => (
                <StickerThumb
                  key={s.id}
                  sticker={s}
                  onPick={(picked) => {
                    onPick(picked);
                    onOpenChange(false);
                  }}
                  onDelete={(picked) => del.mutate(picked)}
                />
              ))}
            </div>
            {!isLoading && stickers.length === 0 && (
              <p className="pt-4 text-center text-xs text-muted-foreground">
                Belum ada stiker. Buat dari foto favoritmu.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
