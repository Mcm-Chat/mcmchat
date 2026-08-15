import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Pencil,
  Check,
  Download,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MCMAvatar, StatusBadge } from "./primitives";
import { UserAvatar } from "./user-avatar";
import { PhotoEditorDialog } from "./photo-editor";
import { compressImage, dataUrlToBlob, koordinat, useGeolocation } from "@/lib/mcm/geo";
import type { MessageLocation } from "@/lib/mcm/types";
import type { ConversationView } from "@/lib/api/chat";
import { sendMessage } from "@/lib/api/chat";
import { cn } from "@/lib/utils";

export function LocationCard({
  location,
  compact,
}: {
  location: MessageLocation;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-2.5 text-card-foreground",
        compact && "text-xs",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <MapPin className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <p className="truncate text-xs font-semibold">{location.label}</p>
            {location.source === "demo" && <StatusBadge tone="warning">Lokasi Demo</StatusBadge>}
            {location.source === "manual" && <StatusBadge tone="neutral">Manual</StatusBadge>}
          </div>
          <p className="mt-0.5 font-mono text-[10px] break-all text-muted-foreground">
            {koordinat(location.latitude, location.longitude)}
            {location.accuracy > 0 ? ` • ±${location.accuracy} m` : ""}
          </p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="mt-2 h-8 w-full rounded-lg text-xs">
        <a href={location.mapsUrl} target="_blank" rel="noreferrer">
          Buka Maps
        </a>
      </Button>
    </div>
  );
}

const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "MC";

/**
 * Alur kirim foto profesional: pilih penerima → ambil foto → lokasi → keterangan.
 * Foto dan lokasi dikirim sebagai SATU pesan agar tidak pernah terpisah.
 */
export function PhotoFlow({
  userId,
  conversations,
  fixedConversationIds,
  startWithCamera,
  sourceMode = "choose",
  locationDefault = true,
  onDone,
  onCancel,
}: {
  userId: string;
  conversations: ConversationView[];
  fixedConversationIds?: string[] | undefined;
  startWithCamera?: boolean | undefined;
  sourceMode?: "choose" | "camera" | "gallery" | undefined;
  locationDefault?: boolean | undefined;
  onDone: (conversationIds: string[], firstMessageId: string) => void;
  onCancel: () => void;
}) {
  const fixed = (fixedConversationIds ?? []).length > 0;
  const [step, setStep] = useState<"kamera" | "penerima" | "review">(
    startWithCamera && !fixed ? "kamera" : fixed ? "review" : "penerima",
  );
  const [selected, setSelected] = useState<string[]>(fixedConversationIds ?? []);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState("");
  // Editor foto dibuka otomatis sekali setiap foto baru dipilih (kamera/galeri),
  // dan bisa dibuka lagi kapan pun lewat tombol "Edit foto" pada pratinjau.
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState("");
  const [includeLocation, setIncludeLocation] = useState(locationDefault);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ lat: "", lng: "" });
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const geo = useGeolocation();

  const list = useMemo(
    () =>
      conversations.filter(
        (c) => !c.me.is_archived && c.title_resolved.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [conversations, q],
  );
  const recent = useMemo(() => list.slice(0, 3), [list]);
  const selectedConvs = conversations.filter((c) => selected.includes(c.id));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Berkas harus berupa gambar");
      return;
    }
    setBusy(true);
    try {
      const { previewUrl } = await compressImage(file);
      setPreview(previewUrl);
      setEditing(true);
      if (includeLocation && !geo.location) geo.request();
      setStep((s) => (s === "kamera" ? "penerima" : s));
    } catch {
      toast.error("Gagal memproses foto");
    } finally {
      setBusy(false);
    }
  };

  const applyManual = () => {
    const lat = Number(manual.lat);
    const lng = Number(manual.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      toast.error("Latitude harus antara -90 dan 90");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      toast.error("Longitude harus antara -180 dan 180");
      return;
    }
    geo.setManual(lat, lng);
    setManualOpen(false);
  };

  const send = async () => {
    if (sending.current) return;
    if (selected.length === 0) {
      toast.error("Pilih minimal satu penerima");
      return;
    }
    if (!preview) {
      toast.error("Pilih atau ambil foto dulu");
      return;
    }
    if (includeLocation && !geo.location) {
      toast.error("Lokasi belum tersedia. Coba lagi, pilih manual, atau matikan Sertakan lokasi.");
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const blob = await dataUrlToBlob(preview);
      const loc = includeLocation && geo.location ? geo.location : null;
      const ids: string[] = [];
      for (const convId of selected) {
        const msg = await sendMessage({
          conversationId: convId,
          senderId: userId,
          kind: "image",
          body: caption.trim(),
          file: { blob, name: "foto.jpg" },
          location: loc
            ? {
                lat: loc.latitude,
                lng: loc.longitude,
                accuracy: loc.accuracy,
                label: loc.label,
                mapsUrl: loc.mapsUrl,
              }
            : null,
        });
        ids.push(msg.id);
      }
      toast.success(
        selected.length === 1 ? "Foto terkirim" : `Foto terkirim ke ${selected.length} chat`,
      );
      onDone(selected, ids[0]!);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Foto gagal dikirim");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /** Unduh salinan foto yang sudah diedit ke penyimpanan perangkat. */
  const saveToDevice = async () => {
    if (!preview) return;
    try {
      const blob = await dataUrlToBlob(preview);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MCM-foto-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success("Salinan foto diunduh ke penyimpanan perangkat");
    } catch {
      toast.error("Gagal mengunduh salinan foto");
    }
  };

  const sendLabel =
    selected.length > 1
      ? `Kirim ke ${selected.length} chat`
      : `Kirim ke ${selectedConvs[0]?.title_resolved.split(" ")[0] ?? "penerima"}`;

  const fileInputs = (
    <>
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  // Editor tampil di atas langkah mana pun supaya foto yang baru dipilih
  // (kamera atau galeri) langsung bisa dipotong/dianotasi sebelum dikirim.
  if (editing && preview) {
    return (
      <PhotoEditorDialog
        src={preview}
        title="Edit foto sebelum dikirim"
        doneLabel="Gunakan foto"
        onCancel={() => setEditing(false)}
        onDone={(dataUrl) => {
          setPreview(dataUrl);
          setEditing(false);
          toast.success(
            selected.length > 0
              ? "Foto siap. Tekan Kirim untuk mengirimnya."
              : "Foto siap. Pilih penerima lalu tekan Kirim.",
          );
        }}
      />
    );
  }

  if (step === "kamera") {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
        {fileInputs}
        <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
          {busy ? (
            <Loader2 className="size-9 animate-spin text-primary" />
          ) : (
            <Camera className="size-9 text-primary" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">Ambil foto</p>
          <p className="text-sm text-muted-foreground">
            Kamera terbuka dulu. Penerima dipilih setelah foto siap.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button
            className="h-12 rounded-2xl"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="size-5" /> Buka kamera
          </Button>
          <Button
            variant="outline"
            className="h-12 rounded-2xl"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
          >
            <ImageIcon className="size-5" /> Pilih dari galeri
          </Button>
          <Button variant="ghost" className="rounded-2xl" onClick={onCancel}>
            Batal
          </Button>
        </div>
      </div>
    );
  }

  if (step === "penerima") {
    return (
      <div className="flex min-h-0 flex-col">
        {fileInputs}
        {preview && (
          <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
            <img
              src={preview}
              alt="Foto yang akan dikirim"
              className="size-14 shrink-0 rounded-xl border border-border object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Foto siap dikirim</p>
              <p className="text-[11px] text-muted-foreground">
                Belum terkirim — pilih penerima lalu tekan Kirim.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="h-9 rounded-lg text-xs"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" /> Edit
            </Button>
          </div>
        )}
        <div className="space-y-3 px-4 pt-2 pb-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              maxLength={60}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari kontak atau grup"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          {!q && recent.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Terakhir dihubungi
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {recent.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={cn(
                      "flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl border p-2",
                      selected.includes(c.id) ? "border-primary bg-primary/10" : "border-border",
                    )}
                  >
                    {c.other ? (
                      <UserAvatar
                        userId={c.other.id}
                        path={c.other.avatar_url}
                        version={c.other.avatar_version}
                        name={c.title_resolved}
                        color={c.other.avatar_color}
                        size="sm"
                      />
                    ) : (
                      <MCMAvatar
                        initials={initialsOf(c.title_resolved)}
                        color="#0ea5e9"
                        size="sm"
                      />
                    )}
                    <span className="w-full truncate text-center text-[11px]">
                      {c.title_resolved}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <div
                onClick={() => toggle(c.id)}
                role="checkbox"
                aria-checked={selected.includes(c.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(c.id);
                  }
                }}
                className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50"
              >
                {c.other ? (
                  <UserAvatar
                    userId={c.other.id}
                    path={c.other.avatar_url}
                    version={c.other.avatar_version}
                    name={c.title_resolved}
                    color={c.other.avatar_color}
                    size="sm"
                  />
                ) : (
                  <MCMAvatar initials={initialsOf(c.title_resolved)} color="#0ea5e9" size="sm" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{c.title_resolved}</span>
                    {c.type === "group" && (
                      <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {c.type === "group"
                      ? `Grup • ${c.members.length} anggota`
                      : (c.other?.pin ?? "Kontak")}
                  </span>
                </span>
                <Checkbox
                  checked={selected.includes(c.id)}
                  aria-label={`Pilih ${c.title_resolved}`}
                  className="pointer-events-none"
                />
              </div>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              Tidak ada hasil.
            </li>
          )}
        </ul>
        <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <Button variant="ghost" className="rounded-xl" onClick={onCancel}>
            Batal
          </Button>
          <Button
            className="flex-1 rounded-xl"
            disabled={selected.length === 0}
            onClick={() => setStep("review")}
          >
            Lanjut{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section className="rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Kirim ke</p>
            {!fixed && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-lg text-xs"
                onClick={() => setStep("penerima")}
              >
                Ubah
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedConvs.map((c) => (
              <span
                key={c.id}
                className="flex max-w-full items-center gap-1.5 rounded-full bg-muted py-1 pr-2.5 pl-1"
              >
                {c.other ? (
                  <UserAvatar
                    userId={c.other.id}
                    path={c.other.avatar_url}
                    version={c.other.avatar_version}
                    name={c.title_resolved}
                    color={c.other.avatar_color}
                    size="xs"
                  />
                ) : (
                  <MCMAvatar initials={initialsOf(c.title_resolved)} color="#0ea5e9" size="xs" />
                )}
                <span className="truncate text-xs font-medium">{c.title_resolved}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Foto</p>
          {preview ? (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-2xl border border-border">
                <img src={preview} alt="Pratinjau foto" className="max-h-72 w-full object-cover" />
                <Button
                  size="icon"
                  variant="secondary"
                  className="absolute top-2 right-2 size-11 rounded-full"
                  aria-label="Hapus foto"
                  onClick={() => setPreview("")}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  className="h-11 rounded-xl"
                  aria-label="Edit foto sebelum dikirim"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-4" /> Edit foto
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl"
                  disabled={busy}
                  onClick={() => galleryRef.current?.click()}
                >
                  <ImageIcon className="size-4" /> Ganti foto
                </Button>
              </div>
              <Button
                variant="ghost"
                className="h-10 w-full rounded-xl text-xs"
                onClick={() => void saveToDevice()}
              >
                <Download className="size-4" /> Simpan salinan ke perangkat
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Hasil edit disimpan sementara di aplikasi. Foto baru tersimpan permanen di dalam
                chat setelah tombol Kirim ditekan.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={sourceMode === "camera" ? "default" : "outline"}
                className={cn("h-20 flex-col rounded-2xl", sourceMode === "gallery" && "order-2")}
                disabled={busy}
                onClick={() => cameraRef.current?.click()}
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}{" "}
                <span className="text-xs">Kamera</span>
              </Button>
              <Button
                variant={sourceMode === "gallery" ? "default" : "outline"}
                className={cn("h-20 flex-col rounded-2xl", sourceMode === "gallery" && "order-1")}
                disabled={busy}
                onClick={() => galleryRef.current?.click()}
              >
                <ImageIcon className="size-5" /> <span className="text-xs">Galeri</span>
              </Button>
            </div>
          )}
          {fileInputs}
        </section>

        <section className="space-y-2 rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="loc-toggle" className="text-sm font-medium">
              Sertakan lokasi
            </Label>
            <Switch
              id="loc-toggle"
              checked={includeLocation}
              onCheckedChange={(v) => {
                setIncludeLocation(v);
                if (v && !geo.location) geo.request();
              }}
            />
          </div>
          {includeLocation && (
            <>
              {geo.status === "loading" && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Mengambil lokasi…
                </p>
              )}
              {geo.status === "idle" && !geo.location && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={geo.request}
                >
                  Ambil lokasi sekarang
                </Button>
              )}
              {geo.location && (
                <>
                  <p className="flex items-center gap-1.5 text-xs text-success">
                    <Check className="size-3.5" />
                    {geo.location.source === "gps"
                      ? `Lokasi ditemukan ±${geo.location.accuracy} m`
                      : geo.location.source === "demo"
                        ? "Memakai lokasi contoh"
                        : "Lokasi manual dipakai"}
                  </p>
                  <LocationCard location={geo.location} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-lg text-xs"
                    onClick={geo.request}
                  >
                    Perbarui lokasi GPS
                  </Button>
                </>
              )}
              {geo.status === "error" && !geo.location && (
                <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
                  <p className="text-xs font-medium text-destructive">{geo.error}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs"
                      onClick={geo.request}
                    >
                      Coba Lagi
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg text-xs"
                      onClick={() => setManualOpen((v) => !v)}
                    >
                      Pilih lokasi manual
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-lg text-xs"
                      onClick={() => {
                        setIncludeLocation(false);
                        geo.clear();
                      }}
                    >
                      Kirim tanpa lokasi
                    </Button>
                  </div>
                  {manualOpen && (
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={manual.lat}
                          onChange={(e) => setManual((p) => ({ ...p, lat: e.target.value }))}
                          placeholder="Latitude"
                          inputMode="decimal"
                          className="h-9 rounded-lg text-xs"
                        />
                        <Input
                          value={manual.lng}
                          onChange={(e) => setManual((p) => ({ ...p, lng: e.target.value }))}
                          placeholder="Longitude"
                          inputMode="decimal"
                          className="h-9 rounded-lg text-xs"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-8 w-full rounded-lg text-xs"
                        onClick={applyManual}
                      >
                        Pakai koordinat ini
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section className="space-y-1.5">
          <Label htmlFor="photo-caption" className="text-xs font-semibold text-muted-foreground">
            Keterangan
          </Label>
          <Textarea
            id="photo-caption"
            value={caption}
            maxLength={300}
            rows={2}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Tambahkan keterangan (opsional)"
            className="resize-none rounded-xl"
          />
        </section>
      </div>

      <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          aria-label="Kembali"
          onClick={fixed ? onCancel : () => setStep("penerima")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          className="flex-1 rounded-xl"
          disabled={!preview || busy}
          onClick={() => void send()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{" "}
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}

/** Alur khusus berbagi lokasi—tidak menyamarkannya sebagai alur unggah foto. */
export function LocationShareFlow({
  userId,
  conversationId,
  onDone,
  onCancel,
}: {
  userId: string;
  conversationId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const geo = useGeolocation();
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ lat: "", lng: "" });
  const [busy, setBusy] = useState(false);

  const applyManual = () => {
    const lat = Number(manual.lat);
    const lng = Number(manual.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      toast.error("Latitude harus antara -90 dan 90");
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      toast.error("Longitude harus antara -180 dan 180");
      return;
    }
    geo.setManual(lat, lng);
    setManualOpen(false);
  };

  const send = async () => {
    if (!geo.location || busy) return;
    setBusy(true);
    try {
      await sendMessage({
        conversationId,
        senderId: userId,
        kind: "location",
        body: geo.location.label,
        location: {
          lat: geo.location.latitude,
          lng: geo.location.longitude,
          accuracy: geo.location.accuracy,
          label: geo.location.label,
          mapsUrl: geo.location.mapsUrl,
        },
      });
      toast.success("Lokasi terkirim");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lokasi gagal dikirim");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div aria-live="polite">
        {geo.status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Mencari lokasi GPS…
          </p>
        )}
        {geo.location && <LocationCard location={geo.location} />}
        {geo.status === "error" && <p className="text-sm text-destructive">{geo.error}</p>}
      </div>

      {!geo.location && !manualOpen && (
        <div className="grid gap-2">
          <Button
            className="h-12 rounded-xl"
            disabled={geo.status === "loading"}
            onClick={geo.request}
          >
            <MapPin className="size-4" /> Gunakan lokasi saat ini
          </Button>
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => setManualOpen(true)}>
            Masukkan koordinat manual
          </Button>
        </div>
      )}

      {manualOpen && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Latitude"
              inputMode="decimal"
              placeholder="Latitude"
              value={manual.lat}
              onChange={(e) => setManual((p) => ({ ...p, lat: e.target.value }))}
            />
            <Input
              aria-label="Longitude"
              inputMode="decimal"
              placeholder="Longitude"
              value={manual.lng}
              onChange={(e) => setManual((p) => ({ ...p, lng: e.target.value }))}
            />
          </div>
          <Button className="w-full" onClick={applyManual}>
            Gunakan koordinat
          </Button>
        </div>
      )}

      {geo.location && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-12 rounded-xl"
            disabled={busy}
            onClick={geo.request}
          >
            Perbarui GPS
          </Button>
          <Button className="h-12 rounded-xl" disabled={busy} onClick={() => void send()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Kirim
            lokasi
          </Button>
        </div>
      )}
      <Button variant="ghost" className="w-full" disabled={busy} onClick={onCancel}>
        Batal
      </Button>
    </div>
  );
}
