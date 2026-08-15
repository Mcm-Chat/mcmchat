import { useMemo, useState } from "react";
import { Camera, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rupiah } from "@/lib/mcm/format";
import {
  toWarehouseBase,
  warehouseUnit,
  warehouseUnitOptions,
  type ProductRow,
} from "@/lib/api/catalog";
import { recordPurchase } from "@/lib/api/purchases";
import { uploadProductPhoto } from "@/lib/api/storage";
import { compressImage, mapsUrlFor, sanitizeMapsUrl } from "@/lib/mcm/geo";

export type PurchaseProduct = Pick<
  ProductRow,
  "id" | "name" | "business_id" | "stock_kind" | "base_unit" | "buy_unit" | "buy_factor"
>;

/**
 * Dialog pembelian lengkap: agen/pemasok, jumlah + satuan beli, dan harga
 * modal. Stok masuk ke gudang induk lewat RPC `record_purchase`; varian ecer
 * otomatis mengambil dari stok gudang yang sama.
 */
export function PurchaseDialog({
  open,
  onOpenChange,
  product,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: PurchaseProduct;
  onDone?: (() => void) | undefined;
}) {
  const units = useMemo(() => warehouseUnitOptions(product), [product]);
  const [unit, setUnit] = useState(() => warehouseUnit(product));
  const [supplier, setSupplier] = useState("");
  const [contact, setContact] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoPath, setPhotoPath] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [locUrl, setLocUrl] = useState("");
  const [locLabel, setLocLabel] = useState("");

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { blob, previewUrl } = await compressImage(file);
      const res = await uploadProductPhoto(product.business_id, blob, file.name);
      setPhotoPath(res.path);
      setPhotoPreview(previewUrl);
      toast.success("Foto barang masuk siap disimpan");
    } catch {
      toast.error("Gagal mengunggah foto");
    } finally {
      setUploading(false);
    }
  };

  const useCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Perangkat ini tidak mendukung GPS");
      return;
    }
    toast.info("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocUrl(mapsUrlFor(pos.coords.latitude, pos.coords.longitude));
        toast.success("Lokasi diambil dari GPS");
      },
      () => toast.error("Lokasi tidak tersedia."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const qtyNum = Number(qty.replace(",", "."));
  const costNum = Number(cost.replace(/[^\d]/g, ""));
  const total = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum * (costNum || 0) : 0;

  const submit = async () => {
    if (supplier.trim().length < 2) {
      toast.error("Nama agen/pemasok wajib diisi");
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast.error("Jumlah pembelian tidak valid");
      return;
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      toast.error("Harga modal tidak valid");
      return;
    }
    setSaving(true);
    try {
      const safeLoc = sanitizeMapsUrl(locUrl);
      if (safeLoc === null) {
        toast.error("Link lokasi harus berupa alamat https yang valid.");
        setSaving(false);
        return;
      }
      const qtyBase = toWarehouseBase(product, qtyNum, unit);
      await recordPurchase({
        productId: product.id,
        supplierName: supplier.trim(),
        supplierContact: contact.trim(),
        qtyBase,
        displayQty: qtyNum,
        displayUnit: unit,
        unitCost: costNum,
        totalCost: total,
        note: note.trim(),
        purchasedAt: date ? new Date(`${date}T00:00:00`).toISOString() : null,
        photoPath,
        locationUrl: safeLoc,
        locationLabel: locLabel.trim(),
      });
      toast.success("Pembelian tercatat & stok gudang bertambah");
      setSupplier("");
      setContact("");
      setQty("");
      setCost("");
      setNote("");
      setPhotoPath("");
      setPhotoPreview("");
      setLocUrl("");
      setLocLabel("");
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pembelian");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Catat pembelian gudang</DialogTitle>
          <DialogDescription>
            Stok masuk ke gudang {product.name}. Semua varian ecer memotong dari stok ini.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Agen / pemasok</Label>
            <Input
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Contoh: CV Sumber Pasir"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kontak agen (opsional)</Label>
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="No. HP / alamat"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>Jumlah</Label>
              <Input
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="w-28 space-y-1.5">
              <Label>Satuan</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Harga modal per {unit} (Rp)</Label>
            <Input
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tanggal pembelian</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Catatan</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opsional: no. nota, ongkos kirim"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Foto barang masuk</Label>
            {photoPreview ? (
              <div className="relative w-fit">
                <img
                  src={photoPreview}
                  alt="Foto barang masuk"
                  className="size-24 rounded-xl object-cover"
                />
                <button
                  type="button"
                  aria-label="Hapus foto"
                  className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground"
                  onClick={() => {
                    setPhotoPath("");
                    setPhotoPreview("");
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                <Camera className="size-4" />
                {uploading ? "Mengunggah…" : "Ambil / pilih foto"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void pickPhoto(e.target.files?.[0])}
                />
              </label>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Label lokasi (opsional)</Label>
            <Input
              value={locLabel}
              onChange={(e) => setLocLabel(e.target.value)}
              placeholder="Contoh: Gudang A"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Link Maps</Label>
            <Input
              value={locUrl}
              onChange={(e) => setLocUrl(e.target.value)}
              placeholder="https://maps.google.com/…"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg text-xs"
              onClick={useCurrentLocation}
            >
              <MapPin className="size-3.5" /> Ambil lokasi saat ini
            </Button>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <p className="text-[11px] text-muted-foreground">Total modal</p>
            <p className="text-lg font-bold">{rupiah(total)}</p>
          </div>
        </div>
        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? "Menyimpan…" : "Simpan pembelian"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
