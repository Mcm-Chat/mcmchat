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
import {
  toWarehouseBase,
  warehouseUnit,
  warehouseUnitOptions,
  type ProductRow,
} from "@/lib/api/catalog";
import { recordPurchase } from "@/lib/api/purchases";

export type PurchaseProduct = Pick<
  ProductRow,
  "id" | "name" | "stock_kind" | "base_unit" | "buy_unit" | "buy_factor"
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
      });
      toast.success("Pembelian tercatat & stok gudang bertambah");
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
