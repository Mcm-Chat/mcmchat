import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ImagePlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog, StatusBadge } from "@/components/mcm/primitives";
import { PhotoCard } from "@/components/mcm/catalog-parts";
import { addProductPhotos, formatQty, toBase, type PhotoRow, type VariantRow } from "@/lib/api/catalog";
import {
  UNIT_STATUS_LABEL,
  UNIT_STATUS_TONE,
  activateUnit,
  createUnit,
  listUnits,
  voidUnit,
  type StockUnitWithPhotos,
} from "@/lib/api/stock-units";
import { compressImage } from "@/lib/mcm/geo";

export const unitsKey = (variantId: string) => ["catalog", "units", variantId];

/**
 * Panel unit fisik per varian. Satu kartu = satu barang nyata dengan foto,
 * lokasi, dan catatannya sendiri sehingga pembeli melihat barang yang benar.
 */
export function VariantUnitsPanel({
  variant,
  businessId,
  productId,
  onEditLocation,
  onDeletePhoto,
}: {
  variant: VariantRow;
  businessId: string;
  productId: string;
  onEditLocation: (p: PhotoRow) => void;
  onDeletePhoto: (p: PhotoRow) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const { data: units = [], isLoading } = useQuery({
    queryKey: unitsKey(variant.id),
    queryFn: () => listUnits(variant.id),
    enabled: open,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: unitsKey(variant.id) });
    void qc.invalidateQueries({ queryKey: ["catalog"] });
  };

  const active = units.filter((u) => u.status !== "void" && u.status !== "delivered");

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-h-[36px] items-center gap-2 text-xs font-semibold"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <Boxes className="size-4 text-primary" />
          Unit fisik
          {open ? null : (
            <span className="text-[11px] font-normal text-muted-foreground">(ketuk untuk buka)</span>
          )}
        </button>
        {open && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-[11px]"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" /> Tambah unit
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {isLoading ? (
            <p className="text-[11px] text-muted-foreground">Memuat unit…</p>
          ) : active.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-2.5 text-center text-[11px] text-muted-foreground">
              Belum ada unit fisik. Tambahkan unit untuk tiap barang nyata yang siap dijual.
            </p>
          ) : (
            active.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                variant={variant}
                businessId={businessId}
                productId={productId}
                onChanged={invalidate}
                onEditLocation={onEditLocation}
                onDeletePhoto={(p) => {
                  onDeletePhoto(p);
                  invalidate();
                }}
              />
            ))
          )}
        </div>
      )}

      {addOpen && (
        <AddUnitDialog
          variant={variant}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function UnitCard({
  unit,
  variant,
  businessId,
  productId,
  onChanged,
  onEditLocation,
  onDeletePhoto,
}: {
  unit: StockUnitWithPhotos;
  variant: VariantRow;
  businessId: string;
  productId: string;
  onChanged: () => void;
  onEditLocation: (p: PhotoRow) => void;
  onDeletePhoto: (p: PhotoRow) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const editable = unit.status === "draft" || unit.status === "available";

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy) return;
    setBusy(true);
    try {
      const drafts = [];
      for (const f of Array.from(files)) {
        const { blob } = await compressImage(f);
        drafts.push({
          file: blob,
          fileName: f.name,
          variant_id: variant.id,
          stock_unit_id: unit.id,
          group_label: unit.label || `Unit #${unit.unit_seq}`,
        });
      }
      await addProductPhotos(businessId, productId, drafts);
      onChanged();
      toast.success(`${drafts.length} foto ditambahkan ke unit`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menambah foto unit");
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onChanged();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memproses unit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-soft space-y-2 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">
            {unit.label || `Unit #${unit.unit_seq}`}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatQty(variant, Number(unit.qty_base))}
            {unit.note ? ` · ${unit.note}` : ""}
          </p>
        </div>
        <StatusBadge tone={UNIT_STATUS_TONE[unit.status]}>
          {UNIT_STATUS_LABEL[unit.status]}
        </StatusBadge>
      </div>

      {unit.photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {unit.photos.map((ph, i) => (
            <PhotoCard
              key={ph.id}
              photo={ph}
              index={i}
              onEditLocation={() => onEditLocation(ph)}
              onDelete={() => onDeletePhoto(ph)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Belum ada foto. Unit wajib punya minimal satu foto sebelum bisa dijual.
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap gap-1.5">
        {editable && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-[11px]"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3.5" /> Foto unit
          </Button>
        )}
        {unit.status === "draft" && (
          <Button
            size="sm"
            className="h-8 rounded-lg text-[11px]"
            disabled={busy || unit.photos.length === 0}
            onClick={() => void run(() => activateUnit(unit.id), "Unit siap dijual")}
          >
            Aktifkan
          </Button>
        )}
        {editable && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg text-[11px] text-destructive"
            disabled={busy}
            onClick={() => setConfirmVoid(true)}
          >
            Batalkan unit
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmVoid}
        onOpenChange={setConfirmVoid}
        title="Batalkan unit ini?"
        description="Unit tidak akan bisa dipesan lagi dan stok gudang disesuaikan otomatis."
        destructive
        confirmLabel="Batalkan"
        onConfirm={() => void run(() => voidUnit(unit.id, "Dibatalkan penjual"), "Unit dibatalkan")}
      />
    </div>
  );
}

function AddUnitDialog({
  variant,
  onClose,
  onCreated,
}: {
  variant: VariantRow;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [qty, setQty] = useState("1");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Jumlah unit harus lebih dari nol");
      return;
    }
    setSaving(true);
    try {
      await createUnit({
        variantId: variant.id,
        qtyBase: toBase(variant, n),
        label: label.trim(),
        note: note.trim(),
      });
      toast.success("Unit dibuat sebagai draf");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat unit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Tambah unit fisik</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Jumlah per unit ({variant.display_unit})</Label>
            <Input
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Contoh: 1"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Label (opsional)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Contoh: Karung A"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Catatan (opsional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Unit dibuat sebagai draf. Tambahkan foto lalu aktifkan agar masuk stok dan bisa dipesan.
          </p>
        </div>
        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? "Menyimpan…" : "Buat unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
