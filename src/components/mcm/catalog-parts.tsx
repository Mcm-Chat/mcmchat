import { useState } from "react";
import { Copy, ExternalLink, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/mcm/primitives";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import { formatQty, type PhotoRow, type VariantRow } from "@/lib/api/catalog";
import { rupiah } from "@/lib/mcm/format";

export function StockChip({
  variant,
  balance,
}: {
  variant: Pick<
    VariantRow,
    "stock_type" | "display_unit" | "conversion_factor" | "allow_decimal" | "name"
  >;
  balance: number;
}) {
  const low = balance <= 0;
  return (
    <StatusBadge tone={low ? "danger" : "primary"} className="whitespace-nowrap">
      {variant.name}: {formatQty(variant, balance)}
    </StatusBadge>
  );
}

export function ProductThumb({
  path,
  className,
}: {
  path?: string | null | undefined;
  className?: string | undefined;
}) {
  const url = useSignedUrl("product-photos", path);
  if (!url) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-muted text-2xl ${className ?? "size-16"}`}
      >
        📦
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Foto produk"
      className={`rounded-xl object-cover ${className ?? "size-16"}`}
    />
  );
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link lokasi disalin");
  } catch {
    toast.error("Tidak bisa menyalin link");
  }
}

export function PhotoCard({
  photo,
  index,
  onEditLocation,
  onDelete,
  actions,
}: {
  photo: PhotoRow;
  index: number;
  onEditLocation: () => void;
  onDelete: () => void;
  actions?: React.ReactNode;
}) {
  const url = useSignedUrl("product-photos", photo.image_path);
  const hasLocation = photo.location_url.trim().length > 0;
  return (
    <div className="card-soft overflow-hidden" data-testid={`gallery-photo-${index + 1}`}>
      {url ? (
        <img
          src={url}
          alt={photo.caption || `Foto ${index + 1}`}
          className="h-36 w-full object-cover"
        />
      ) : (
        <div className="flex h-36 w-full items-center justify-center bg-muted text-3xl">📦</div>
      )}
      <div className="space-y-2 p-3">
        <p className="truncate text-xs font-semibold">{photo.caption || `Foto ${index + 1}`}</p>
        {hasLocation ? (
          <>
            <p className="truncate text-[11px] text-muted-foreground">
              {photo.location_label || photo.location_url}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <a
                href={photo.location_url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Buka Lokasi foto ${index + 1}`}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground"
              >
                <MapPin className="size-3.5" /> Buka Lokasi
              </a>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-[11px]"
                onClick={() => void copyLink(photo.location_url)}
              >
                <Copy className="size-3.5" /> Salin Link
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-[11px]"
                onClick={onEditLocation}
              >
                <Pencil className="size-3.5" /> Edit Lokasi
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <p className="text-[11px] text-muted-foreground">Tanpa lokasi.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-[11px]"
              onClick={onEditLocation}
            >
              <Pencil className="size-3.5" /> Edit Lokasi
            </Button>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {actions}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-lg text-[11px] text-destructive"
            onClick={onDelete}
          >
            Hapus
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EditLocationDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: { location_url: string; location_label: string };
  onSave: (v: {
    location_url: string;
    location_label: string;
    location_lat: number | null;
    location_lng: number | null;
    location_mode: "auto" | "manual" | "none";
  }) => void;
}) {
  const [url, setUrl] = useState(initial.location_url);
  const [label, setLabel] = useState(initial.location_label);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    extractCoords(initial.location_url),
  );
  const [mode, setMode] = useState<"auto" | "manual" | "none">(
    initial.location_url ? "manual" : "none",
  );

  const useCurrent = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Perangkat ini tidak mendukung GPS");
      return;
    }
    toast.info("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const link = mapsUrlFor(pos.coords.latitude, pos.coords.longitude);
        setUrl(link);
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMode("auto");
        toast.success("Lokasi diambil dari GPS");
      },
      () => toast.error("Lokasi tidak tersedia."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Edit lokasi foto</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Label lokasi</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Contoh: Gudang A"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Link Maps</Label>
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setCoords(extractCoords(e.target.value));
                setMode(e.target.value.trim() ? "manual" : "none");
              }}
              placeholder="https://maps.google.com/…"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg text-xs"
              onClick={useCurrent}
            >
              <MapPin className="size-3.5" /> Ambil lokasi saat ini
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            className="w-full rounded-xl"
            onClick={() => {
              const safe = sanitizeMapsUrl(url);
              if (safe === null) {
                toast.error("Link lokasi harus berupa alamat https yang valid.");
                return;
              }
              onSave({
                location_url: safe,
                location_label: label.trim(),
                location_lat: coords?.lat ?? null,
                location_lng: coords?.lng ?? null,
                location_mode: safe === "" ? "none" : mode,
              });
              onOpenChange(false);
            }}
          >
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function priceLabel(price: number) {
  return rupiah(price);
}
