import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Images,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addPreparePhoto,
  completePrepareTask,
  getPrepareTask,
  openPrepareTask,
  removePreparePhoto,
  savePrepareItem,
} from "@/lib/prepare.functions";
import { fileToDataUrl, koordinat, mapsUrlFor } from "@/lib/mcm/geo";
import type { PrepItem, PrepTask } from "@/lib/prepare.server.types";

export const Route = createFileRoute("/prepare/$token")({
  head: () => ({
    meta: [
      { title: "Tugas Penyiapan — MCM" },
      {
        name: "description",
        content:
          "Halaman tugas penyiapan pegawai: foto barang, lokasi GPS, dan jumlah aktual per item.",
      },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Tugas Penyiapan — MCM" },
      {
        property: "og:description",
        content: "Selesaikan tugas penyiapan barang dengan foto dan lokasi.",
      },
    ],
  }),
  component: PreparePage,
});

function PreparePage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const fetchTask = useServerFn(getPrepareTask);
  const open = useServerFn(openPrepareTask);
  const complete = useServerFn(completePrepareTask);

  const { data, isLoading } = useQuery({
    queryKey: ["prep-task", token],
    queryFn: () => fetchTask({ data: { token } }),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data?.ok) void open({ data: { token } });
  }, [data?.ok, open, token]);

  const completing = useMutation({
    mutationFn: () => complete({ data: { token } }),
    onSuccess: (res) => {
      toast.success(
        res.already ? "Tugas ini sudah selesai sebelumnya" : "Tugas selesai. Hasil masuk katalog.",
      );
      void qc.invalidateQueries({ queryKey: ["prep-task", token] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal menyelesaikan tugas"),
  });

  if (isLoading) {
    return (
      <Center>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </Center>
    );
  }

  if (!data?.ok) {
    return (
      <Center>
        <ShieldAlert className="size-10 text-destructive" />
        <h1 className="text-lg font-semibold">Tautan tidak berlaku</h1>
        <p className="text-sm text-muted-foreground">
          Tautan tugas ini sudah dicabut, kedaluwarsa, atau tidak sah. Minta admin menerbitkan ulang
          barcode.
        </p>
      </Center>
    );
  }

  const task: PrepTask = data.task;
  const done = task.status === "completed";
  const ready = task.items.every((i) => itemComplete(i));

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-[430px] space-y-3 px-4 py-4">
        <header className="card-soft space-y-1 p-4">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold">{task.code}</h1>
            <Badge variant={done ? "default" : "secondary"}>
              {done ? "Selesai" : "Perlu disiapkan"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">Pelanggan: {task.customer_name || "—"}</p>
          <p className="text-xs text-muted-foreground">{task.business_name}</p>
          {task.notes && (
            <p className="rounded-lg bg-muted p-2 text-xs">Catatan admin: {task.notes}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {task.items.filter(itemComplete).length}/{task.items.length} item siap
          </p>
        </header>

        {task.items.map((item) => (
          <ItemBlock key={item.id} token={token} item={item} readOnly={done} />
        ))}

        <Button
          className="h-12 w-full rounded-xl"
          disabled={done || !ready || completing.isPending}
          onClick={() => completing.mutate()}
        >
          {completing.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {done ? "Tugas sudah selesai" : "Selesai & kirim ke katalog"}
        </Button>
        {!done && !ready && (
          <p className="pb-6 text-center text-xs text-muted-foreground">
            Lengkapi foto, lokasi, dan jumlah aktual pada setiap item wajib untuk mengaktifkan
            tombol selesai.
          </p>
        )}
      </div>
    </div>
  );
}

function itemComplete(i: PrepItem) {
  if (i.require_photo && i.photos.length === 0) return false;
  if (i.require_location && !i.photos.some((p) => p.lat !== null && p.lng !== null)) return false;
  return i.actual_qty_base !== null && i.actual_qty_base > 0;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
      {children}
    </div>
  );
}

function ItemBlock({
  token,
  item,
  readOnly,
}: {
  token: string;
  item: PrepItem;
  readOnly: boolean;
}) {
  const qc = useQueryClient();
  const save = useServerFn(savePrepareItem);
  const addPhoto = useServerFn(addPreparePhoto);
  const removePhoto = useServerFn(removePreparePhoto);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [qty, setQty] = useState(String(item.actual_qty_base ?? item.requested_qty_base));
  const [notes, setNotes] = useState(item.notes);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["prep-task", token] });

  const askLocation = () =>
    new Promise<{ lat: number; lng: number; accuracy: number } | null>((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGeoError("Perangkat ini tidak mendukung GPS.");
        resolve(null);
        return;
      }
      setGeoBusy(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
          };
          setCoords(next);
          setGeoError("");
          setGeoBusy(false);
          resolve(next);
        },
        (err) => {
          setGeoBusy(false);
          setGeoError(
            err.code === err.PERMISSION_DENIED
              ? "Izin lokasi ditolak. Aktifkan izin lalu coba lagi."
              : "Lokasi belum didapat. Coba ulangi di area terbuka.",
          );
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
      );
    });

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPendingEdit(await fileToDataUrl(file, 1600));
    } catch {
      toast.error("Foto gagal dibaca");
    }
  };

  const upload = async (dataUrl: string) => {
    setBusy(true);
    try {
      const geo = coords ?? (await askLocation());
      if (item.require_location && !geo) {
        toast.error("Lokasi wajib untuk item ini. Aktifkan GPS lalu coba lagi.");
        return;
      }
      await addPhoto({
        data: {
          token,
          itemId: item.id,
          dataUrl,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          accuracy: geo?.accuracy ?? null,
          label: geo ? koordinat(geo.lat, geo.lng) : "",
          mapsUrl: geo ? mapsUrlFor(geo.lat, geo.lng) : "",
          caption: notes,
        },
      });
      await refresh();
      toast.success("Foto tersimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Foto gagal disimpan");
    } finally {
      setBusy(false);
    }
  };

  const persist = async () => {
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Jumlah aktual harus lebih dari nol");
      return;
    }
    try {
      await save({
        data: { token, itemId: item.id, actualQtyBase: Math.round(n * 100) / 100, notes },
      });
      await refresh();
      toast.success("Jumlah aktual disimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan item");
    }
  };

  return (
    <section className="card-soft space-y-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {item.product_name} — {item.variant_name}
          </h2>
          {item.unit_total > 1 && (
            <p className="text-[11px] font-semibold text-primary">
              Unit {item.unit_index}/{item.unit_total} · setiap unit difoto terpisah
            </p>
          )}
          {item.chat_order_slot_id && (
            <p className="text-[11px] text-muted-foreground">Dari pesanan pembeli di chat</p>
          )}
          <p className="text-xs text-muted-foreground">
            Diminta {item.requested_qty} {item.requested_unit} ({item.requested_qty_base}{" "}
            {item.base_unit})
          </p>
        </div>
        {itemComplete(item) && <CheckCircle2 className="size-5 shrink-0 text-success" />}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`qty-${item.id}`}>Jumlah aktual ({item.base_unit})</Label>
        <Input
          id={`qty-${item.id}`}
          inputMode="decimal"
          value={qty}
          disabled={readOnly}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => !readOnly && void persist()}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`note-${item.id}`}>Catatan item</Label>
        <Textarea
          id={`note-${item.id}`}
          maxLength={300}
          value={notes}
          disabled={readOnly}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => !readOnly && void persist()}
        />
      </div>

      {!readOnly && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              className="rounded-xl"
              disabled={busy}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="size-4" /> Kamera
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl"
              disabled={busy}
              onClick={() => galleryRef.current?.click()}
            >
              <Images className="size-4" /> Galeri
            </Button>
          </div>
          <Button
            variant="ghost"
            className="w-full rounded-xl"
            disabled={geoBusy}
            onClick={() => void askLocation()}
          >
            {geoBusy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            {coords ? `Lokasi siap · ±${coords.accuracy} m` : "Ambil lokasi GPS"}
          </Button>
          {geoError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
              <span className="flex-1">{geoError}</span>
              <Button size="sm" variant="ghost" onClick={() => void askLocation()}>
                <RefreshCw className="size-3.5" /> Coba lagi
              </Button>
            </div>
          )}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      )}

      {item.photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {item.photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-xl border border-border">
              {p.url && (
                <img
                  src={p.url}
                  alt={`Foto ${item.product_name}`}
                  className="h-24 w-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="space-y-1 p-2">
                <p className="truncate text-[10px] text-muted-foreground">
                  {p.lat !== null && p.lng !== null
                    ? `${p.location_label} · ±${p.accuracy ?? 0} m`
                    : "Tanpa lokasi"}
                </p>
                {p.maps_url && (
                  <a
                    href={p.maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[10px] font-semibold text-primary"
                  >
                    Buka lokasi
                  </a>
                )}
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-full text-[10px] text-destructive"
                    onClick={() =>
                      void removePhoto({ data: { token, photoId: p.id } }).then(refresh)
                    }
                  >
                    <Trash2 className="size-3" /> Hapus
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
