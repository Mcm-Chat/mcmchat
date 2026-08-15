import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, MoreVertical, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDecimalId, fromGrams, isWeightUnit, validateVariantDraft } from "@/lib/mcm/decimal";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import {
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  StatusBadge,
} from "@/components/mcm/primitives";
import {
  EditLocationDialog,
  PhotoCard,
  ProductThumb,
  priceLabel,
} from "@/components/mcm/catalog-parts";
import { PurchaseDialog } from "@/components/mcm/purchase-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AiDescriptionButton } from "@/components/mcm/ai-description";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import {
  COUNT_UNITS,
  MOVEMENT_LABEL,
  WEIGHT_UNITS,
  adjustStock,
  adjustWarehouse,
  deletePhoto,
  deleteProduct,
  deleteVariant,
  formatQty,
  formatWarehouseQty,
  getProduct,
  listMovements,
  reorderPhotos,
  toBase,
  toWarehouseBase,
  updatePhotoLocation,
  upsertProduct,
  upsertVariant,
  variantAvailableUnits,
  warehouseUnit,
  warehouseUnitOptions,
  type PhotoRow,
  type ProductWithVariants,
  type StockType,
  type VariantRow,
} from "@/lib/api/catalog";
import { VariantUnitsPanel } from "@/components/mcm/unit-parts";
import { useRequireAuth } from "@/lib/api/guard";
import { jam } from "@/lib/mcm/format";

export const Route = createFileRoute("/catalog/$id")({
  head: () => ({
    meta: [
      { title: "Detail Produk — MCM" },
      { name: "description", content: "Kelola varian, stok, dan foto berlokasi untuk produk ini." },
      { property: "og:title", content: "Detail Produk — MCM" },
      { property: "og:description", content: "Detail produk, varian, dan inventori MCM." },
    ],
  }),
  component: CatalogDetail,
});

function CatalogDetail() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const {
    data: product,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["catalog", "product", id],
    queryFn: () => getProduct(id),
    enabled: !!id,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["catalog", "product", id] });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    category: "",
    description: "",
    price: "",
    stockKind: "count" as StockType,
    buyUnit: "pcs",
    buyFactor: "1",
    purchasePrice: "",
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [variantOpen, setVariantOpen] = useState<VariantRow | null | "new">(null);
  const [stockDialog, setStockDialog] = useState<{
    variant: VariantRow;
    mode: "add" | "correct";
  } | null>(null);
  const [movementsFor, setMovementsFor] = useState<VariantRow | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [warehouseFix, setWarehouseFix] = useState(false);
  const [editLocationPhoto, setEditLocationPhoto] = useState<PhotoRow | null>(null);

  if (loading || isLoading) {
    return (
      <AppShell header={<MobileHeader title="Produk" back />}>
        <LoadingSkeleton rows={3} avatar={false} />
      </AppShell>
    );
  }

  if (!userId) return null;

  if (isError || !product) {
    return (
      <AppShell header={<MobileHeader title="Produk" back />}>
        <EmptyState
          icon={Package}
          title="Produk tidak ditemukan"
          description="Data mungkin sudah dihapus atau terjadi kesalahan jaringan."
          action={
            <Button className="rounded-xl" onClick={() => void refetch()}>
              Coba lagi
            </Button>
          }
        />
      </AppShell>
    );
  }

  const openEdit = () => {
    setEditForm({
      name: product.name,
      category: product.category,
      description: product.description,
      price: String(product.price),
      stockKind: product.stock_kind,
      buyUnit: product.buy_unit || warehouseUnit(product),
      buyFactor: String(product.buy_factor ?? 1),
      purchasePrice: String(product.purchase_price ?? ""),
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const price = Number(editForm.price);
    if (editForm.name.trim().length < 2 || !Number.isFinite(price) || price < 0) {
      toast.error("Periksa nama dan harga produk");
      return;
    }
    try {
      await upsertProduct({
        id: product.id,
        business_id: product.business_id,
        name: editForm.name.trim(),
        category: editForm.category.trim() || "Umum",
        description: editForm.description.trim(),
        price,
        stock_kind: editForm.stockKind,
        base_unit: editForm.stockKind === "weight" ? "g" : "pcs",
        buy_unit: editForm.buyUnit,
        buy_factor:
          editForm.stockKind === "weight"
            ? toWarehouseBase(
                { stock_kind: "weight", base_unit: "g", buy_unit: editForm.buyUnit, buy_factor: 1 },
                1,
                editForm.buyUnit,
              )
            : Number(editForm.buyFactor.replace(",", ".")) || 1,
        purchase_price: Number(editForm.purchasePrice.replace(/[^\d]/g, "")) || 0,
      });
      setEditOpen(false);
      invalidate();
      toast.success("Produk diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan produk");
    }
  };

  const movePhoto = async (photoId: string, dir: -1 | 1, list: PhotoRow[]) => {
    const idx = list.findIndex((p) => p.id === photoId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const ids = list.map((p) => p.id);
    const tmp = ids[idx]!;
    ids[idx] = ids[target]!;
    ids[target] = tmp;
    try {
      await reorderPhotos(ids);
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengurutkan foto");
    }
  };

  const allPhotos = product.photos;
  // Semua media hidup di bawah variannya. Tidak ada jalur UI untuk foto produk
  // tanpa variant_id: foto satu barang tidak boleh tertukar dengan barang lain.
  const orphanPhotos = allPhotos.filter((p) => !p.variant_id && !p.stock_unit_id);

  return (
    <AppShell
      header={
        <MobileHeader
          title={product.name}
          subtitle={product.category}
          back
          actions={
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit produk"
                className="size-9"
                onClick={openEdit}
              >
                <MoreVertical className="size-5" />
              </Button>
            </>
          }
        />
      }
    >
      <div className="space-y-5 p-4 pb-10">
        <div className="card-soft space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{product.name}</p>
              <p className="text-sm text-muted-foreground">
                {product.description || "Tanpa deskripsi"}
              </p>
            </div>
            <ProductThumb path={allPhotos[0]?.image_path} className="size-16" />
          </div>
          <p className="text-lg font-bold text-primary">{priceLabel(Number(product.price))}</p>
          <div className="rounded-xl bg-muted/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Stok gudang (induk)</p>
                <p className="text-base font-bold">
                  {formatWarehouseQty(product, product.warehouse)}
                </p>
              </div>
              <StatusBadge tone={product.warehouse <= 0 ? "danger" : "primary"}>
                {product.stock_kind === "weight" ? "Timbangan" : "Hitungan"}
              </StatusBadge>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Harga beli: {priceLabel(Number(product.purchase_price ?? 0))} / {warehouseUnit(product)}
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                size="sm"
                className="h-8 flex-1 rounded-lg text-[11px]"
                onClick={() => setPurchaseOpen(true)}
              >
                <Plus className="size-3.5" /> Catat pembelian
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 rounded-lg text-[11px]"
                onClick={() => setWarehouseFix(true)}
              >
                <Minus className="size-3.5" /> Koreksi gudang
              </Button>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1 rounded-xl" onClick={openEdit}>
              Edit produk
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 rounded-xl text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" /> Hapus
            </Button>
          </div>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Varian / ecer dari gudang</h2>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={() => setVariantOpen("new")}
            >
              <Plus className="size-3.5" /> Tambah varian
            </Button>
          </div>
          {product.variants.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Belum ada varian. Tambahkan varian untuk mulai melacak stok.
            </p>
          ) : (
            <div className="space-y-2">
              {product.variants.map((v) => (
                <VariantRowCard
                  key={v.id}
                  variant={v}
                  businessId={product.business_id}
                  productId={product.id}
                  photos={allPhotos.filter((p) => p.variant_id === v.id && !p.stock_unit_id)}
                  onAdd={() => setPurchaseOpen(true)}
                  warehouse={product.warehouse}
                  stockKind={product.stock_kind}
                  onCorrect={() => setStockDialog({ variant: v, mode: "correct" })}
                  onEdit={() => setVariantOpen(v)}
                  onHistory={() => setMovementsFor(v)}
                  onSend={() =>
                    void navigate({ to: "/chat", search: { send: product.id, variant: v.id } })
                  }
                  onEditLocation={(ph) => setEditLocationPhoto(ph)}
                  onDeletePhoto={(ph) =>
                    void (async () => {
                      try {
                        await deletePhoto(ph.id);
                        invalidate();
                        toast.success("Foto dihapus");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Gagal menghapus foto");
                      }
                    })()
                  }
                />
              ))}
            </div>
          )}
        </section>

        {orphanPhotos.length > 0 && (
          <section className="space-y-3" data-testid="orphan-photos">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Foto lama tanpa varian</h2>
              <StatusBadge tone="warning">{orphanPhotos.length} perlu ditautkan</StatusBadge>
            </div>
            <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
              Foto ini berasal dari versi lama dan belum menempel pada varian mana pun. Foto baru
              hanya bisa ditambahkan dari kartu unit fisik di dalam varian.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {orphanPhotos.map((ph, i) => (
                <PhotoCard
                  key={ph.id}
                  photo={ph}
                  index={i}
                  onEditLocation={() => setEditLocationPhoto(ph)}
                  onDelete={() =>
                    void (async () => {
                      try {
                        await deletePhoto(ph.id);
                        invalidate();
                        toast.success("Foto dihapus");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Gagal menghapus foto");
                      }
                    })()
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit produk</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nama produk</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Input
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Harga jual dasar (Rp)</Label>
              <Input
                type="number"
                min={0}
                value={editForm.price}
                onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
              />
            </div>
            <div className="space-y-2 rounded-xl border border-border p-2.5">
              <p className="text-[11px] font-semibold tracking-[0.04em] uppercase">
                Gudang (stok induk)
              </p>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Jenis stok</Label>
                  <Select
                    value={editForm.stockKind}
                    onValueChange={(v) =>
                      setEditForm((f) => ({
                        ...f,
                        stockKind: v as StockType,
                        buyUnit: v === "weight" ? "kg" : "pcs",
                      }))
                    }
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weight">Timbangan</SelectItem>
                      <SelectItem value="count">Hitungan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28 space-y-1.5">
                  <Label className="text-xs">Satuan beli</Label>
                  <Select
                    value={editForm.buyUnit}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, buyUnit: v }))}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(editForm.stockKind === "weight" ? WEIGHT_UNITS : COUNT_UNITS).map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editForm.stockKind === "count" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Isi per {editForm.buyUnit} (pcs)</Label>
                  <Input
                    inputMode="numeric"
                    value={editForm.buyFactor}
                    onChange={(e) => setEditForm((f) => ({ ...f, buyFactor: e.target.value }))}
                    placeholder="1"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Harga beli per {editForm.buyUnit} (Rp)</Label>
                <Input
                  inputMode="numeric"
                  value={editForm.purchasePrice}
                  onChange={(e) => setEditForm((f) => ({ ...f, purchasePrice: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Deskripsi</Label>
                <AiDescriptionButton
                  name={editForm.name}
                  category={editForm.category}
                  price={Number(editForm.price) || undefined}
                  currentDescription={editForm.description}
                  onApply={(text) => setEditForm((f) => ({ ...f, description: text }))}
                />
              </div>
              <Textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full rounded-xl" onClick={saveEdit}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Hapus produk?"
        description="Produk beserta variannya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan."
        destructive
        confirmLabel="Hapus"
        onConfirm={() =>
          void (async () => {
            try {
              await deleteProduct(product.id);
              toast.success("Produk dihapus");
              void navigate({ to: "/catalog" });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Gagal menghapus produk");
            }
          })()
        }
      />

      {variantOpen && (
        <VariantEditorDialog
          businessId={product.business_id}
          productId={product.id}
          variant={variantOpen === "new" ? null : variantOpen}
          sortOrder={product.variants.length}
          onClose={() => setVariantOpen(null)}
          onSaved={() => {
            setVariantOpen(null);
            invalidate();
          }}
          onDeleted={() => {
            setVariantOpen(null);
            invalidate();
          }}
        />
      )}

      {stockDialog && (
        <StockDialog
          variant={stockDialog.variant}
          mode={stockDialog.mode}
          onClose={() => setStockDialog(null)}
          onDone={() => {
            setStockDialog(null);
            invalidate();
          }}
        />
      )}

      {movementsFor && (
        <MovementsSheet variant={movementsFor} onClose={() => setMovementsFor(null)} />
      )}

      {purchaseOpen && (
        <PurchaseDialog
          open
          onOpenChange={(v) => !v && setPurchaseOpen(false)}
          product={product}
          onDone={() => {
            setPurchaseOpen(false);
            invalidate();
          }}
        />
      )}

      {warehouseFix && (
        <WarehouseAdjustDialog
          product={product}
          onClose={() => setWarehouseFix(false)}
          onDone={() => {
            setWarehouseFix(false);
            invalidate();
          }}
        />
      )}

      {editLocationPhoto && (
        <EditLocationDialog
          open={!!editLocationPhoto}
          onOpenChange={(v) => !v && setEditLocationPhoto(null)}
          initial={{
            location_url: editLocationPhoto.location_url,
            location_label: editLocationPhoto.location_label,
          }}
          onSave={(patch) =>
            void (async () => {
              try {
                await updatePhotoLocation(editLocationPhoto.id, patch);
                invalidate();
                toast.success("Lokasi foto diperbarui");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Gagal memperbarui lokasi");
              }
            })()
          }
        />
      )}
    </AppShell>
  );
}

function VariantRowCard({
  variant,
  businessId,
  productId,
  photos,
  onAdd,
  onCorrect,
  onEdit,
  onHistory,
  onSend,
  onEditLocation,
  onDeletePhoto,
  warehouse,
  stockKind,
}: {
  variant: VariantRow & { balance: number };
  businessId: string;
  productId: string;
  photos: PhotoRow[];
  onAdd: () => void;
  onCorrect: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onSend: () => void;
  onEditLocation: (p: PhotoRow) => void;
  onDeletePhoto: (p: PhotoRow) => void;
  warehouse: number;
  stockKind: StockType;
}) {
  const available = variantAvailableUnits({ stock_kind: stockKind }, variant, warehouse);
  return (
    <div className="card-soft space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{variant.name}</p>
          <p className="text-xs text-muted-foreground">{priceLabel(Number(variant.price))}</p>
        </div>
        <StatusBadge tone={available <= 0 ? "danger" : "primary"}>
          {stockKind === "weight"
            ? formatQty(variant, warehouse)
            : `${new Intl.NumberFormat("id-ID").format(available)} ${variant.display_unit}`}
        </StatusBadge>
      </div>
      <p className="text-[11px] text-muted-foreground">Diambil dari stok gudang bersama.</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-8 rounded-lg text-[11px]" onClick={onAdd}>
          <Plus className="size-3.5" /> Beli / tambah stok
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-lg text-[11px]"
          onClick={onCorrect}
        >
          <Minus className="size-3.5" /> Koreksi stok
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-lg text-[11px]"
          onClick={onHistory}
        >
          Riwayat
        </Button>
        <Button size="sm" variant="ghost" className="h-8 rounded-lg text-[11px]" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={onSend}>
          Kirim ke Pelanggan
        </Button>
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          {photos.map((ph, i) => (
            <PhotoCard
              key={ph.id}
              photo={ph}
              index={i}
              onEditLocation={() => onEditLocation(ph)}
              onDelete={() => onDeletePhoto(ph)}
            />
          ))}
        </div>
      )}
      <VariantUnitsPanel
        variant={variant}
        businessId={businessId}
        productId={productId}
        onEditLocation={onEditLocation}
        onDeletePhoto={onDeletePhoto}
      />
    </div>
  );
}

/** Koreksi cepat stok gudang induk (tambah / kurangi) dalam satuan beli. */
function WarehouseAdjustDialog({
  product,
  onClose,
  onDone,
}: {
  product: ProductWithVariants;
  onClose: () => void;
  onDone: () => void;
}) {
  const units = warehouseUnitOptions(product);
  const [unit, setUnit] = useState(() => warehouseUnit(product));
  const [qty, setQty] = useState("");
  const [mode, setMode] = useState<"add" | "reduce">("add");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Jumlah tidak valid");
      return;
    }
    setSaving(true);
    try {
      const base = toWarehouseBase(product, n, unit);
      await adjustWarehouse(
        product.id,
        mode === "add" ? base : -base,
        mode === "add" ? "restock" : "adjustment",
        note.trim() || "Koreksi manual gudang",
      );
      toast.success("Stok gudang diperbarui");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui stok gudang");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Koreksi stok gudang</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={mode === "add" ? "default" : "outline"}
              className="h-9 flex-1 rounded-lg text-xs"
              onClick={() => setMode("add")}
            >
              Tambah
            </Button>
            <Button
              size="sm"
              variant={mode === "reduce" ? "default" : "outline"}
              className="h-9 flex-1 rounded-lg text-xs"
              onClick={() => setMode("reduce")}
            >
              Kurangi
            </Button>
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
            <Label>Catatan</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opsional: alasan koreksi"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stok sekarang: {formatWarehouseQty(product, product.warehouse)}
          </p>
        </div>
        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? "Menyimpan…" : "Simpan koreksi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariantEditorDialog({
  businessId,
  productId,
  variant,
  sortOrder,
  onClose,
  onSaved,
  onDeleted,
}: {
  businessId: string;
  productId: string;
  variant: VariantRow | null;
  sortOrder: number;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(variant?.name ?? "");
  const [stockType, setStockType] = useState<StockType>(variant?.stock_type ?? "weight");
  const [displayUnit, setDisplayUnit] = useState(
    variant?.display_unit ?? (stockType === "weight" ? "g" : "pcs"),
  );
  const [unitsPerDisplay, setUnitsPerDisplay] = useState(
    String(variant?.units_per_display ?? variant?.conversion_factor ?? 1),
  );
  const [weightQty, setWeightQty] = useState(() => {
    const grams = Number(variant?.base_quantity_grams ?? 0);
    const unit = variant?.display_unit ?? "g";
    if (!grams || !isWeightUnit(unit)) return "1";
    return String(fromGrams(grams, unit));
  });
  const [price, setPrice] = useState(String(variant?.price ?? 0));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const units = stockType === "weight" ? WEIGHT_UNITS : COUNT_UNITS;

  const draft = {
    name,
    stock_kind: stockType,
    display_unit: displayUnit,
    display_quantity: weightQty,
    units_per_display: unitsPerDisplay,
    price,
  } as const;
  const check = validateVariantDraft(draft);
  const gramPreview =
    stockType === "weight" && check.ok
      ? formatDecimalId(check.value.base_quantity_grams ?? 0)
      : null;

  const save = async () => {
    if (saving) return;
    if (!check.ok) {
      toast.error(check.message);
      return;
    }
    setSaving(true);
    try {
      await upsertVariant({
        id: variant?.id,
        business_id: businessId,
        product_id: productId,
        name: check.value.name,
        stock_type: stockType,
        display_unit: check.value.display_unit,
        base_unit: check.value.base_unit,
        display_quantity: weightQty,
        units_per_display: stockType === "count" ? unitsPerDisplay : null,
        allow_decimal: stockType === "weight",
        price: check.value.price,
        sort_order: variant?.sort_order ?? sortOrder,
      });
      toast.success("Varian disimpan");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan varian");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{variant ? "Edit varian" : "Varian baru"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nama varian</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Kemasan 1kg"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Jenis stok</Label>
            <Select
              value={stockType}
              onValueChange={(v: StockType) => {
                setStockType(v);
                setDisplayUnit(v === "weight" ? "g" : "pcs");
              }}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weight">Berat (gram/kg)</SelectItem>
                <SelectItem value="count">Hitungan (pcs/botol/dll)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Satuan tampilan</Label>
            <Select value={displayUnit} onValueChange={setDisplayUnit}>
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
          {stockType === "weight" && (
            <div className="space-y-1.5">
              <Label>Jumlah berat</Label>
              <Input
                inputMode="decimal"
                value={weightQty}
                onChange={(e) => setWeightQty(e.target.value)}
                placeholder="Contoh: 0,2"
              />
              <p className="text-[11px] text-muted-foreground">
                {gramPreview
                  ? `Setara ${gramPreview} gram`
                  : !check.ok && check.field === "display_quantity"
                    ? check.message
                    : "Berat minimum 0,0001 gram (0,1 mg)."}
              </p>
            </div>
          )}
          {stockType === "count" && (
            <div className="space-y-1.5">
              <Label>Isi per satuan (mis. 1 karton = 24 pcs)</Label>
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={unitsPerDisplay}
                onChange={(e) => setUnitsPerDisplay(e.target.value)}
              />
              {!check.ok && check.field === "units_per_display" && (
                <p className="text-[11px] text-destructive">{check.message}</p>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Harga varian (Rp)</Label>
            <Input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Contoh: 100.000"
            />
            {!check.ok && check.field === "price" && (
              <p className="text-[11px] text-destructive">{check.message}</p>
            )}
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="w-full rounded-xl" onClick={save} disabled={!check.ok || saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
          {variant && (
            <Button
              variant="outline"
              className="w-full rounded-xl text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Hapus varian
            </Button>
          )}
        </DialogFooter>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Hapus varian?"
          description="Jika varian sudah punya riwayat transaksi, varian hanya akan dinonaktifkan."
          destructive
          confirmLabel="Hapus"
          onConfirm={() =>
            void (async () => {
              if (!variant) return;
              try {
                await deleteVariant(variant.id);
                toast.success("Varian dihapus");
                onDeleted();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Gagal menghapus varian");
              }
            })()
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function StockDialog({
  variant,
  mode,
  onClose,
  onDone,
}: {
  variant: VariantRow;
  mode: "add" | "correct";
  onClose: () => void;
  onDone: () => void;
}) {
  const units = variant.stock_type === "weight" ? WEIGHT_UNITS : COUNT_UNITS;
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(variant.display_unit || units[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n === 0) {
      toast.error("Jumlah tidak valid");
      return;
    }
    setSubmitting(true);
    try {
      const base = toBase(variant, Math.abs(n), unit);
      const signedBase = mode === "add" ? base : n < 0 ? -base : base;
      await adjustStock(
        variant.id,
        signedBase,
        mode === "add" ? "restock" : "adjustment",
        note.trim(),
      );
      toast.success("Stok diperbarui");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui stok");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Tambah stok" : "Koreksi stok"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>{mode === "add" ? "Jumlah" : "Jumlah (isi negatif untuk kurangi)"}</Label>
              <Input
                type="number"
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
            <Label>Catatan</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opsional" />
          </div>
        </div>
        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={submitting} onClick={submit}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementsSheet({ variant, onClose }: { variant: VariantRow; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog", "movements", variant.id],
    queryFn: () => listMovements(variant.id),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Riwayat stok — {variant.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <LoadingSkeleton rows={3} avatar={false} />
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat.</p>
        ) : (
          <div className="space-y-2">
            {data.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-border p-2.5 text-xs"
              >
                <div>
                  <p className="font-medium">{MOVEMENT_LABEL[m.movement_type]}</p>
                  <p className="text-muted-foreground">
                    {jam(m.created_at)} · {m.note || "Tanpa catatan"}
                  </p>
                </div>
                <p
                  className={
                    m.qty_base >= 0
                      ? "font-semibold text-success"
                      : "font-semibold text-destructive"
                  }
                >
                  {m.qty_base >= 0 ? "+" : ""}
                  {formatQty(variant, m.qty_base)}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
