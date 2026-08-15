import { useMemo, useState } from "react";
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
import { COUNT_UNITS, WEIGHT_UNITS, toBase, type VariantRow } from "@/lib/api/catalog";
import { recordPurchase } from "@/lib/api/purchases";

export type PurchaseVariant = Pick<
  VariantRow,
  "id" | "name" | "stock_type" | "display_unit" | "conversion_factor" | "price"
>;

/**
 * Dialog pembelian lengkap: agen/pemasok, jenis (varian), jumlah + satuan,
 * dan harga modal. Stok bertambah otomatis lewat RPC `record_purchase`.
 */
export function PurchaseDialog({
  open,
  onOpenChange,
  variants,
  defaultVariantId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  variants: PurchaseVariant[];
  defaultVariantId?: string | undefined;
  onDone?: (() => void) | undefined;
}) {
  const [variantId, setVariantId] = useState(defaultVariantId ?? variants[0]?.id ?? "");
  const variant = useMemo(
    () => variants.find((v) => v.id === variantId) ?? variants[0],
    [variants, variantId],
  );
  const units = variant?.stock_type === "weight" ? WEIGHT_UNITS : COUNT_UNITS;
  const [unit, setUnit] = useState(variant?.display_unit ?? "pcs");
  const [supplier, setSupplier] = useState("");
  const [contact, setContact] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const qtyNum = Number(qty.replace(",", "."));
  const costNum = Number(cost.replace(/[^\d]/g, ""));
  const total = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum * (costNum || 0) : 0;

  const submit = async () => {
    if (!variant) {
      toast.error("Pilih jenis (varian) terlebih dahulu");
      return;
    }
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
      const qtyBase = toBase(
        { stock_type: variant.stock_type, conversion_factor: variant.conversion_factor },
        qtyNum,
        unit,
      );
      await recordPurchase({
        variantId: variant.id,
        supplierName: supplier.trim(),
        supplierContact: contact.trim(),
        qtyBase,
        displayQty: qtyNum,
        displayUnit: unit,
        unitCost: costNum,
        totalCost: total,
        note: note.trim(),
        purchasedAt: date ? new Date(`${date}T00:00:00`).toISOString() : null,
      });
      toast.success("Pembelian tercatat & stok bertambah");
      setSupplier("");
      setContact("");
      setQty("");
      setCost("");
      setNote("");
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
          <DialogTitle>Catat pembelian</DialogTitle>
          <DialogDescription>
            Isi asal agen, jenis barang, jumlah, dan harga modal. Stok dan indikator laba akan
            langsung diperbarui.
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
          <div className="space-y-1.5">
            <Label>Jenis yang dibeli</Label>
            <Select
              value={variant?.id ?? ""}
              onValueChange={(v) => {
                setVariantId(v);
                const found = variants.find((x) => x.id === v);
                if (found) setUnit(found.display_unit);
              }}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="Pilih varian" />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} · {rupiah(Number(v.price))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
