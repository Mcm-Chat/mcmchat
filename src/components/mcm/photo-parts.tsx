import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
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
import { chatSortValue, uid, useMCM } from "@/lib/mcm/store";
import { fileToDataUrl, koordinat, useGeolocation } from "@/lib/mcm/geo";
import type { MessageLocation } from "@/lib/mcm/types";
import { cn } from "@/lib/utils";

export function LocationCard({ location, compact }: { location: MessageLocation; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-2.5 text-card-foreground", compact && "text-xs")}>
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

export function PhotoFlow({
  fixedChatIds,
  onDone,
  onCancel,
}: {
  fixedChatIds?: string[] | undefined;
  onDone: (chatIds: string[], messageId: string) => void;
  onCancel: () => void;
}) {
  const { state, update } = useMCM();
  const fixed = (fixedChatIds ?? []).length > 0;
  const [step, setStep] = useState<"penerima" | "review">(fixed ? "review" : "penerima");
  const [selected, setSelected] = useState<string[]>(fixedChatIds ?? []);
  const [q, setQ] = useState("");
  const [dataUrl, setDataUrl] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [includeLocation, setIncludeLocation] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ lat: "", lng: "" });
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const geo = useGeolocation();

  const chats = useMemo(
    () =>
      state.chats
        .filter((c) => !c.archived)
        .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => chatSortValue(state, b) - chatSortValue(state, a)),
    [state, q],
  );
  const recent = useMemo(() => chats.slice(0, 3), [chats]);
  const selectedChats = state.chats.filter((c) => selected.includes(c.id));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Berkas harus berupa gambar");
      return;
    }
    setBusy(true);
    try {
      const url = await fileToDataUrl(file);
      setDataUrl(url);
      if (includeLocation && !geo.location) geo.request();
    } catch {
      toast.error("Gagal memproses foto");
    } finally {
      setBusy(false);
    }
  };

  const useDemoPhoto = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 640, 480);
      g.addColorStop(0, "#0f766e");
      g.addColorStop(1, "#0b1f3a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "bold 34px sans-serif";
      ctx.fillText("Foto Demo MCM", 150, 250);
    }
    setDataUrl(canvas.toDataURL("image/jpeg", 0.7));
    if (includeLocation && !geo.location) geo.request();
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

  const send = () => {
    if (sending.current) return;
    if (selected.length === 0) {
      toast.error("Pilih minimal satu penerima");
      return;
    }
    if (!dataUrl) {
      toast.error("Pilih atau ambil foto dulu");
      return;
    }
    if (includeLocation && !geo.location) {
      toast.error("Lokasi belum tersedia. Coba lagi, pilih manual, atau matikan Sertakan lokasi.");
      return;
    }
    sending.current = true;
    const firstId = uid("m");
    const at = new Date().toISOString();
    const loc = includeLocation ? geo.location : null;
    update((d) => {
      selected.forEach((chatId, i) => {
        d.messages.push({
          id: i === 0 ? firstId : uid("m"),
          chatId,
          senderId: "me",
          senderName: d.profile.name,
          kind: "image",
          text: caption.trim(),
          at,
          status: "sent",
          reactions: [],
          attachmentName: "foto.jpg",
          mediaDataUrl: dataUrl,
          ...(loc ? { location: loc } : {}),
        });
      });
      return d;
    });
    toast.success(selected.length === 1 ? "Foto terkirim" : `Foto terkirim ke ${selected.length} chat`);
    onDone(selected, firstId);
  };

  const toggle = (id: string) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const sendLabel =
    selected.length > 1
      ? `Kirim ke ${selected.length} chat`
      : `Kirim ke ${selectedChats[0]?.name.split(" ")[0] ?? "penerima"}`;

  if (step === "penerima") {
    return (
      <div className="flex min-h-0 flex-col">
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
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Terakhir dihubungi</p>
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
                    <MCMAvatar initials={c.initials} color={c.avatarColor} size="sm" />
                    <span className="w-full truncate text-center text-[11px]">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto">
          {chats.map((c) => {
            const contact = state.contacts.find((x) => x.id === c.contactId);
            return (
              <li key={c.id}>
                <div
                  type="button"
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
                  <MCMAvatar initials={c.initials} color={c.avatarColor} size="sm" online={contact?.online ?? false} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      {c.type === "group" && <Users className="size-3.5 shrink-0 text-muted-foreground" />}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {c.type === "group" ? `Grup • ${c.memberIds.length} anggota` : (contact?.pin ?? "Kontak")}
                    </span>
                  </span>
                  <Checkbox checked={selected.includes(c.id)} aria-label={`Pilih ${c.name}`} className="pointer-events-none" />
                </div>
              </li>
            );
          })}
          {chats.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">Tidak ada hasil.</li>}
        </ul>
        <div className="sticky bottom-0 flex gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <Button variant="ghost" className="rounded-xl" onClick={onCancel}>
            Batal
          </Button>
          <Button className="flex-1 rounded-xl" disabled={selected.length === 0} onClick={() => setStep("review")}>
            Lanjut{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* 1. penerima */}
        <section className="rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted-foreground">Kirim ke</p>
            {!fixed && (
              <Button variant="ghost" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setStep("penerima")}>
                Ubah
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedChats.map((c) => (
              <span key={c.id} className="flex max-w-full items-center gap-1.5 rounded-full bg-muted py-1 pr-2.5 pl-1">
                <MCMAvatar initials={c.initials} color={c.avatarColor} size="xs" />
                <span className="truncate text-xs font-medium">{c.name}</span>
              </span>
            ))}
          </div>
        </section>

        {/* 2. foto */}
        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Foto</p>
          {dataUrl ? (
            <div className="relative overflow-hidden rounded-2xl border border-border">
              <img src={dataUrl} alt="Pratinjau foto" className="max-h-72 w-full object-cover" />
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-2 right-2 size-8 rounded-full"
                aria-label="Hapus foto"
                onClick={() => setDataUrl("")}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-20 flex-col rounded-2xl" disabled={busy} onClick={() => cameraRef.current?.click()}>
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />} <span className="text-xs">Kamera</span>
              </Button>
              <Button variant="outline" className="h-20 flex-col rounded-2xl" disabled={busy} onClick={() => galleryRef.current?.click()}>
                <ImageIcon className="size-5" /> <span className="text-xs">Galeri</span>
              </Button>
              <Button variant="ghost" className="col-span-2 rounded-xl text-xs" onClick={useDemoPhoto}>
                Gunakan foto demo
              </Button>
            </div>
          )}
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
        </section>

        {/* 3. lokasi */}
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
                <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={geo.request}>
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
                        ? "Memakai lokasi demo"
                        : "Lokasi manual dipakai"}
                  </p>
                  <LocationCard location={geo.location} />
                  <Button size="sm" variant="ghost" className="h-7 rounded-lg text-xs" onClick={geo.request}>
                    Perbarui lokasi GPS
                  </Button>
                </>
              )}
              {geo.status === "error" && !geo.location && (
                <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2.5">
                  <p className="text-xs font-medium text-destructive">{geo.error}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={geo.request}>
                      Coba Lagi
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => setManualOpen((v) => !v)}>
                      Pilih lokasi manual
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={geo.useDemo}>
                      Gunakan lokasi demo
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
                      <Button size="sm" className="h-8 w-full rounded-lg text-xs" onClick={applyManual}>
                        Pakai koordinat ini
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* 4. caption */}
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
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="Kembali" onClick={fixed ? onCancel : () => setStep("penerima")}>
          <ArrowLeft className="size-4" />
        </Button>
        <Button className="flex-1 rounded-xl" disabled={!dataUrl} onClick={send}>
          <Send className="size-4" /> {sendLabel}
        </Button>
      </div>
    </div>
  );
}