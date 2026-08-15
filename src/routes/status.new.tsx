import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { StatusEditor } from "@/components/mcm/status-editor";
import { LoadingSkeleton } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/lib/api/guard";
import { useContacts } from "@/lib/api/queries";
import { postStatus, type NewSlide } from "@/lib/api/status";
import { useStatusPrefs } from "@/lib/status/hooks";
import { composeStatus, textStatusMeta } from "@/lib/status/compose";
import { loadEditableImage } from "@/lib/status/load-image";
import { type EditorState } from "@/lib/status/editor";
import {
  clampSlideMs,
  LIFETIME_OPTIONS,
  SLIDE_OPTIONS,
  TEXT_BACKGROUNDS,
  TEXT_FONTS,
  type StatusPrivacy,
} from "@/lib/status/model";

export const Route = createFileRoute("/status/new")({
  head: () => ({
    meta: [
      { title: "Buat Status — MCM" },
      {
        name: "description",
        content:
          "Susun status foto atau teks MCM: filter, coretan, sensor, teks, durasi, dan privasi per status.",
      },
      { property: "og:title", content: "Buat Status — MCM" },
      {
        property: "og:description",
        content: "Editor status MCM dengan filter, coretan, sensor, dan kontrol privasi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StatusNew,
});

function StatusNew() {
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: prefs } = useStatusPrefs(userId ?? undefined);
  const { data: contacts } = useContacts(userId ?? undefined);

  const [slides, setSlides] = useState<(NewSlide & { preview: string })[]>([]);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [text, setText] = useState("");
  const [bg, setBg] = useState<string>(TEXT_BACKGROUNDS[0]);
  const [font, setFont] = useState<string>(TEXT_FONTS[0].css);
  const [slideMs, setSlideMs] = useState(5000);
  const [lifetime, setLifetime] = useState(1440);
  const [privacy, setPrivacy] = useState<StatusPrivacy>("contacts");
  const [audience, setAudience] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const effectiveLifetime = lifetime || prefs?.default_lifetime_minutes || 1440;

  const pilihFoto = async (file: File | undefined) => {
    if (!file) return;
    setOpening(true);
    try {
      setImage(await loadEditableImage(file));
    } catch {
      toast.error("Foto tidak bisa dibuka");
    } finally {
      setOpening(false);
    }
  };

  const tambahSlideFoto = async (editorState: EditorState, caption: string) => {
    if (!image) return;
    setBusy(true);
    try {
      const out = await composeStatus(image, editorState);
      setSlides((prev) => [
        ...prev,
        {
          kind: "image",
          blob: out.blob,
          thumb: out.thumb,
          width: out.width,
          height: out.height,
          caption,
          durationMs: clampSlideMs(slideMs),
          preview: URL.createObjectURL(out.thumb),
        },
      ]);
      setImage(null);
      toast.success("Slide ditambahkan");
    } catch {
      toast.error("Slide gagal diproses");
    } finally {
      setBusy(false);
    }
  };

  const tambahSlideTeks = () => {
    const isi = text.trim();
    if (!isi) return;
    setSlides((prev) => [
      ...prev,
      {
        kind: "text",
        textMeta: textStatusMeta(isi, bg, "#ffffff", font),
        caption: "",
        durationMs: clampSlideMs(slideMs),
        preview: "",
      },
    ]);
    setText("");
    toast.success("Slide teks ditambahkan");
  };

  const unggah = async () => {
    if (!userId || slides.length === 0) return;
    setBusy(true);
    try {
      await postStatus({
        userId,
        caption: "",
        privacy,
        audience: privacy === "contacts" ? [] : audience,
        lifetimeMinutes: effectiveLifetime,
        slides: slides.map(({ preview: _preview, ...s }) => s),
      });
      await qc.invalidateQueries({ queryKey: ["status"] });
      toast.success("Status diunggah");
      void navigate({ to: "/status" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Status gagal diunggah");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !userId) return <LoadingSkeleton />;

  return (
    <AppShell
      header={
        <MobileHeader title="Buat status" subtitle={`${slides.length} slide siap diunggah`} back />
      }
    >
      <div className="space-y-5 p-3 pb-24">
        <Tabs defaultValue="foto">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="foto">
              <Camera className="size-4" /> Foto
            </TabsTrigger>
            <TabsTrigger value="teks">
              <Type className="size-4" /> Teks
            </TabsTrigger>
          </TabsList>

          <TabsContent value="foto" className="space-y-3 pt-3">
            {!image ? (
              <div className="grid gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pilihFoto(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-24 flex-col gap-2"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus className="size-6" />
                  Pilih foto atau ambil dari kamera
                </Button>
                <p className="text-xs text-muted-foreground">
                  Foto otomatis dipangkas ke rasio layar penuh 9:16. Video status belum tersedia di
                  versi ini.
                </p>
              </div>
            ) : (
              <>
                <StatusEditor image={image} onStateChange={onStateChange} />
                <div className="space-y-1.5">
                  <Label htmlFor="caption">Keterangan slide</Label>
                  <Input
                    id="caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Opsional"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => void tambahSlideFoto()}
                  >
                    {busy && <Loader2 className="size-4 animate-spin" />} Tambahkan slide
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setImage(null)}>
                    Batal
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="teks" className="space-y-3 pt-3">
            <div
              className="grid min-h-44 place-items-center rounded-2xl px-6 py-8 text-center"
              style={{ background: bg }}
            >
              <p
                className="text-xl font-semibold break-words whitespace-pre-wrap text-white"
                style={{ fontFamily: font }}
              >
                {text || "Ketik status teks Anda…"}
              </p>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Tulis status…"
              maxLength={280}
            />
            <div className="flex flex-wrap gap-2">
              {TEXT_BACKGROUNDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-label="Warna latar"
                  className={cn(
                    "size-9 rounded-xl border-2",
                    bg === b ? "border-primary" : "border-transparent",
                  )}
                  style={{ background: b }}
                  onClick={() => setBg(b)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {TEXT_FONTS.map((f) => (
                <Button
                  key={f.id}
                  type="button"
                  size="sm"
                  variant={font === f.css ? "default" : "outline"}
                  onClick={() => setFont(f.css)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={!text.trim()}
              onClick={tambahSlideTeks}
            >
              Tambahkan slide teks
            </Button>
          </TabsContent>
        </Tabs>

        {slides.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Slide ({slides.length})
            </h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((s, i) => (
                <div
                  key={i}
                  className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-border"
                >
                  {s.preview ? (
                    <img src={s.preview} alt="" className="size-full object-cover" />
                  ) : (
                    <div
                      className="grid size-full place-items-center px-1 text-center text-[9px] text-white"
                      style={{ background: s.textMeta?.background }}
                    >
                      {s.textMeta?.text?.slice(0, 40)}
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label="Hapus slide"
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
                    onClick={() => setSlides((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4 rounded-2xl border border-border p-3">
          <div className="space-y-2">
            <Label>Durasi tiap slide</Label>
            <Select value={String(slideMs)} onValueChange={(v) => setSlideMs(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SLIDE_OPTIONS.map((ms) => (
                  <SelectItem key={ms} value={String(ms)}>
                    {ms / 1000} detik
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Masa aktif status</Label>
            <Select value={String(effectiveLifetime)} onValueChange={(v) => setLifetime(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIFETIME_OPTIONS.map((o) => (
                  <SelectItem key={o.minutes} value={String(o.minutes)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Siapa yang bisa melihat</Label>
            <Select value={privacy} onValueChange={(v) => setPrivacy(v as StatusPrivacy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contacts">Semua kontak saya</SelectItem>
                <SelectItem value="contacts_except">Kontak saya, kecuali…</SelectItem>
                <SelectItem value="only_share_with">Hanya bagikan dengan…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {privacy !== "contacts" && (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border p-2">
              {(contacts ?? []).map((c) => (
                <label
                  key={c.contact_id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"
                >
                  <Checkbox
                    checked={audience.includes(c.contact_id)}
                    onCheckedChange={(v) =>
                      setAudience((prev) =>
                        v ? [...prev, c.contact_id] : prev.filter((id) => id !== c.contact_id),
                      )
                    }
                  />
                  {c.alias || c.profile.display_name}
                </label>
              ))}
              {(contacts ?? []).length === 0 && (
                <p className="p-2 text-xs text-muted-foreground">Belum ada kontak.</p>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-card/95 p-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur">
        <Button
          className="h-12 w-full"
          disabled={slides.length === 0 || busy}
          onClick={() => void unggah()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />} Bagikan status ({slides.length})
        </Button>
      </div>
    </AppShell>
  );
}
