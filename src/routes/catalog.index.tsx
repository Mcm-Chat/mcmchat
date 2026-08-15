import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderCog, Package, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ConfirmDialog, EmptyState, LoadingSkeleton } from "@/components/mcm/primitives";
import { ProductThumb, StockChip, priceLabel } from "@/components/mcm/catalog-parts";
import { AiDescriptionButton } from "@/components/mcm/ai-description";
import { PurchaseDialog } from "@/components/mcm/purchase-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequireAuth } from "@/lib/api/guard";
import { useMyBusiness } from "@/lib/api/queries";
import { createBusiness } from "@/lib/api/business";
import {
  COUNT_UNITS,
  WEIGHT_UNITS,
  deleteProduct,
  formatQty,
  listCatalog,
  toBase,
  upsertProduct,
  upsertVariant,
  type ProductWithVariants,
} from "@/lib/api/catalog";
import {
  productIndicators,
  recordPurchase,
  renameCategory,
  type ProductIndicator,
} from "@/lib/api/purchases";
import { rupiah } from "@/lib/mcm/format";
import { ROLE_LABEL } from "@/lib/api/business";

export const Route = createFileRoute("/catalog/")({
  head: () => ({
    meta: [
      { title: "Katalog — MCM" },
      {
        name: "description",
        content: "Kelola katalog produk, varian, dan stok bisnis Anda di MCM.",
      },
      { property: "og:title", content: "Katalog — MCM" },
      { property: "og:description", content: "Katalog produk dan inventori bisnis MCM." },
    ],
  }),
  component: CatalogIndex,
});

function CatalogIndex() {
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: biz, isLoading: bizLoading } = useMyBusiness(userId);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Semua");
  const [bizOpen, setBizOpen] = useState(false);
  const [bizForm, setBizForm] = useState({ name: "", category: "Umum" });
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    price: "",
    category: "Umum",
    description: "",
    variantName: "Standar",
    unit: "pcs",
    qty: "",
    cost: "",
    supplier: "",
    supplierContact: "",
  });
  const [saving, setSaving] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [buyFor, setBuyFor] = useState<ProductWithVariants | null>(null);
  const [removeFor, setRemoveFor] = useState<ProductWithVariants | null>(null);

  const businessId = biz?.business.id;
  const {
    data: products,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["catalog", "products", businessId ?? ""],
    queryFn: () => listCatalog(businessId!),
    enabled: !!businessId,
  });

  const { data: indicators } = useQuery({
    queryKey: ["catalog", "indicators", businessId ?? ""],
    queryFn: () => productIndicators(businessId!),
    enabled: !!businessId,
  });
  const indicatorMap = useMemo(() => {
    const m = new Map<string, ProductIndicator>();
    for (const row of indicators ?? []) m.set(row.product_id, row);
    return m;
  }, [indicators]);

  const refreshCatalog = () => {
    void qc.invalidateQueries({ queryKey: ["catalog", "products", businessId ?? ""] });
    void qc.invalidateQueries({ queryKey: ["catalog", "indicators", businessId ?? ""] });
  };

  const categories = useMemo(
    () => ["Semua", ...Array.from(new Set((products ?? []).map((p) => p.category)))],
    [products],
  );
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      if (cat !== "Semua" && p.category !== cat) return false;
      if (!term) return true;
      return [p.name, p.description, p.sku]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [products, q, cat]);

  if (loading || bizLoading) {
    return (
      <AppShell header={<MobileHeader title="Katalog" />}>
        <LoadingSkeleton rows={4} avatar />
      </AppShell>
    );
  }

  if (!userId) return null;

  if (!biz) {
    return (
      <AppShell header={<MobileHeader title="Katalog" />}>
        <div className="space-y-4 px-4 py-6">
          <EmptyState
            icon={Package}
            title="Belum punya bisnis"
            description="Buat bisnis terlebih dahulu untuk mulai mengelola katalog dan stok."
            action={
              <Dialog open={bizOpen} onOpenChange={setBizOpen}>
                <DialogTrigger asChild>
                  <Button className="rounded-xl">Buat bisnis</Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Buat bisnis</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Nama bisnis</Label>
                      <Input
                        value={bizForm.name}
                        onChange={(e) => setBizForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Contoh: Toko Kopi Nusa"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Kategori</Label>
                      <Input
                        value={bizForm.category}
                        onChange={(e) => setBizForm((f) => ({ ...f, category: e.target.value }))}
                        placeholder="Contoh: Kuliner"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      className="w-full rounded-xl"
                      onClick={async () => {
                        if (bizForm.name.trim().length < 3) {
                          toast.error("Nama bisnis minimal 3 karakter");
                          return;
                        }
                        try {
                          await createBusiness(
                            userId,
                            bizForm.name.trim(),
                            bizForm.category.trim() || "Umum",
                          );
                          setBizOpen(false);
                          void qc.invalidateQueries({ queryKey: ["business", userId] });
                          toast.success("Bisnis dibuat");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Gagal membuat bisnis");
                        }
                      }}
                    >
                      Simpan
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            }
          />
        </div>
      </AppShell>
    );
  }

  const canManage = biz.role === "owner" || biz.role === "admin";

  const submitProduct = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Nama produk minimal 2 karakter");
      return;
    }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Harga tidak valid");
      return;
    }
    const qtyNum = Number(form.qty.replace(",", "."));
    const costNum = Number(form.cost.replace(/[^\d]/g, ""));
    const wantsPurchase = form.qty.trim().length > 0 || form.cost.trim().length > 0;
    if (wantsPurchase) {
      if (form.supplier.trim().length < 2) {
        toast.error("Nama agen/pemasok wajib diisi untuk pembelian pertama");
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
    }
    setSaving(true);
    try {
      const created = await upsertProduct({
        business_id: businessId!,
        name: form.name.trim(),
        category: form.category.trim() || "Umum",
        description: form.description.trim(),
        price,
      });
      if (wantsPurchase) {
        const isWeight = (WEIGHT_UNITS as readonly string[]).includes(form.unit);
        const variant = await upsertVariant({
          business_id: businessId!,
          product_id: created.id,
          name: form.variantName.trim() || "Standar",
          stock_type: isWeight ? "weight" : "count",
          display_unit: form.unit,
          ...(isWeight ? { base_unit: "g" } : { base_unit: "pcs" }),
          display_quantity: 1,
          units_per_display: 1,
          price,
        });
        const qtyBase = toBase(variant, qtyNum, form.unit);
        await recordPurchase({
          variantId: variant.id,
          supplierName: form.supplier.trim(),
          supplierContact: form.supplierContact.trim(),
          qtyBase,
          displayQty: qtyNum,
          displayUnit: form.unit,
          unitCost: costNum,
          totalCost: qtyNum * costNum,
          note: "Pembelian awal produk",
        });
      }
      setAddOpen(false);
      setForm({
        name: "",
        price: "",
        category: "Umum",
        description: "",
        variantName: "Standar",
        unit: "pcs",
        qty: "",
        cost: "",
        supplier: "",
        supplierContact: "",
      });
      refreshCatalog();
      toast.success(wantsPurchase ? "Produk & pembelian tercatat" : "Produk dibuat");
      void navigate({ to: "/catalog/$id", params: { id: created.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat produk");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      header={
        <MobileHeader
          title="Katalog"
          subtitle={`${biz.business.name} · ${ROLE_LABEL[biz.role]}`}
          actions={
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Tambah produk" className="size-11">
                  <Plus className="size-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Produk baru</DialogTitle>
                  <DialogDescription>
                    Lengkapi data pembelian pertama (agen, jenis, jumlah, harga modal) agar stok dan
                    indikator laba langsung terhubung.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Nama produk</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Contoh: Kopi Arabika"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Kategori</Label>
                    <Input
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                      placeholder="Contoh: Minuman"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Harga dasar (Rp)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.price}
                      onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Deskripsi</Label>
                      <AiDescriptionButton
                        name={form.name}
                        category={form.category}
                        price={Number(form.price) || undefined}
                        currentDescription={form.description}
                        onApply={(text) => setForm((f) => ({ ...f, description: text }))}
                      />
                    </div>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      rows={4}
                      placeholder="Opsional"
                    />
                  </div>
                  <div className="space-y-3 rounded-xl border border-border p-3">
                    <p className="text-xs font-semibold tracking-[0.04em] uppercase">
                      Pembelian pertama (modal)
                    </p>
                    <div className="space-y-1.5">
                      <Label>Agen / pemasok</Label>
                      <Input
                        value={form.supplier}
                        onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
                        placeholder="Contoh: CV Sumber Pasir"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Kontak agen (opsional)</Label>
                      <Input
                        value={form.supplierContact}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, supplierContact: e.target.value }))
                        }
                        placeholder="No. HP / alamat"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Jenis yang dibeli</Label>
                      <Input
                        value={form.variantName}
                        onChange={(e) => setForm((f) => ({ ...f, variantName: e.target.value }))}
                        placeholder="Contoh: Kristal"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 space-y-1.5">
                        <Label>Jumlah</Label>
                        <Input
                          inputMode="decimal"
                          value={form.qty}
                          onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                          placeholder="0"
                        />
                      </div>
                      <div className="w-28 space-y-1.5">
                        <Label>Satuan</Label>
                        <Select
                          value={form.unit}
                          onValueChange={(v) => setForm((f) => ({ ...f, unit: v }))}
                        >
                          <SelectTrigger className="rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[...COUNT_UNITS, ...WEIGHT_UNITS].map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Harga modal per {form.unit} (Rp)</Label>
                      <Input
                        inputMode="numeric"
                        value={form.cost}
                        onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                        placeholder="0"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Total modal:{" "}
                      <span className="font-semibold text-foreground">
                        {rupiah(
                          (Number(form.qty.replace(",", ".")) || 0) *
                            (Number(form.cost.replace(/[^\d]/g, "")) || 0),
                        )}
                      </span>{" "}
                      · kosongkan bagian ini bila belum ada pembelian.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    className="w-full rounded-xl"
                    disabled={saving}
                    onClick={() => void submitProduct()}
                  >
                    {saving ? "Menyimpan…" : "Simpan & lanjut kelola"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        >
          <div className="space-y-2 px-3 pb-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari produk…"
                className="h-11 rounded-xl pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex flex-1 gap-1.5 overflow-x-auto pb-0.5">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCat(c)}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      cat === c
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              {canManage && categories.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Kelola folder kategori"
                  className="size-9 shrink-0"
                  onClick={() => setCatOpen(true)}
                >
                  <FolderCog className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </MobileHeader>
      }
    >
      {isLoading ? (
        <LoadingSkeleton rows={4} avatar />
      ) : isError ? (
        <EmptyState
          icon={Package}
          title="Gagal memuat katalog"
          description="Terjadi kesalahan saat mengambil data. Coba lagi."
          action={
            <Button className="rounded-xl" onClick={() => void refetch()}>
              Coba lagi
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Belum ada produk"
          description="Tambahkan produk pertama untuk mulai berjualan."
          action={
            <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Tambah produk
            </Button>
          }
        />
      ) : (
        <div className="space-y-3 p-4">
          {visible.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              indicator={indicatorMap.get(p.id)}
              canManage={canManage}
              onBuy={() => setBuyFor(p)}
              onDelete={() => setRemoveFor(p)}
            />
          ))}
        </div>
      )}

      {buyFor && buyFor.variants.length > 0 && (
        <PurchaseDialog
          open
          onOpenChange={(v) => !v && setBuyFor(null)}
          variants={buyFor.variants}
          onDone={() => {
            setBuyFor(null);
            refreshCatalog();
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeFor}
        onOpenChange={(v) => !v && setRemoveFor(null)}
        title="Hapus produk?"
        description={`Produk "${removeFor?.name ?? ""}" beserta varian, foto, dan riwayat stoknya akan dihapus permanen.`}
        destructive
        confirmLabel="Hapus"
        onConfirm={() =>
          void (async () => {
            if (!removeFor) return;
            try {
              await deleteProduct(removeFor.id);
              toast.success("Produk dihapus");
              setRemoveFor(null);
              refreshCatalog();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Gagal menghapus produk");
            }
          })()
        }
      />

      <CategoryManagerDialog
        open={catOpen}
        onOpenChange={setCatOpen}
        businessId={businessId!}
        categories={categories.filter((c) => c !== "Semua")}
        onDone={() => {
          setCat("Semua");
          refreshCatalog();
        }}
      />
    </AppShell>
  );
}

function CategoryManagerDialog({
  open,
  onOpenChange,
  businessId,
  categories,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  categories: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [rename, setRename] = useState<Record<string, string>>({});

  const run = async (from: string, to: string, message: string) => {
    setBusy(from);
    try {
      await renameCategory(businessId, from, to);
      toast.success(message);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengubah folder");
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Kelola folder kategori</DialogTitle>
          <DialogDescription>
            Ganti nama folder atau hapus folder. Produk di dalamnya tidak ikut terhapus, hanya
            dipindah ke folder “Umum”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {categories.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Belum ada folder.</p>
          )}
          {categories.map((c) => (
            <div key={c} className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-sm font-semibold">{c}</p>
              <Input
                value={rename[c] ?? c}
                onChange={(e) => setRename((r) => ({ ...r, [c]: e.target.value }))}
                placeholder="Nama folder"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 rounded-xl"
                  disabled={busy === c || (rename[c] ?? c).trim() === c}
                  onClick={() => void run(c, (rename[c] ?? c).trim(), "Nama folder diperbarui")}
                >
                  Simpan nama
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 rounded-xl text-destructive"
                  disabled={busy === c || c === "Umum"}
                  onClick={() => void run(c, "Umum", "Folder dihapus")}
                >
                  <Trash2 className="size-3.5" /> Hapus folder
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductCard({
  product,
  indicator,
  canManage,
  onBuy,
  onDelete,
}: {
  product: ProductWithVariants;
  indicator?: ProductIndicator | undefined;
  canManage: boolean;
  onBuy: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const cover = product.photos[0]?.image_path;
  const unitVariant = product.variants[0];
  const soldLabel =
    indicator && unitVariant ? formatQty(unitVariant, indicator.sold_base) : "0";
  return (
    <div className="card-soft space-y-3 p-3">
      <div className="flex gap-3">
        <Link to="/catalog/$id" params={{ id: product.id }} className="flex min-w-0 flex-1 gap-3">
          <ProductThumb path={cover} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{product.name}</p>
            <p className="text-xs text-muted-foreground">{product.category}</p>
            <p className="mt-1 text-sm font-semibold text-primary">
              {priceLabel(Number(product.price))}
            </p>
          </div>
        </Link>
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Hapus produk ${product.name}`}
            className="size-9 shrink-0 text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {product.variants.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {product.variants.map((v) => (
            <StockChip key={v.id} variant={v} balance={v.balance} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted/50 p-2.5 text-[11px]">
        <Indicator label="Modal masuk" value={rupiah(indicator?.total_cost ?? 0)} />
        <Indicator label="Nilai stok" value={rupiah(indicator?.stock_value ?? 0)} />
        <Indicator label="Terjual" value={soldLabel} />
        <Indicator
          label="Estimasi laba"
          value={rupiah(indicator?.profit ?? 0)}
          tone={(indicator?.profit ?? 0) >= 0 ? "text-success" : "text-destructive"}
        />
        <div className="col-span-2 truncate text-muted-foreground">
          Agen terakhir:{" "}
          <span className="font-medium text-foreground">
            {indicator?.last_supplier || "Belum ada pembelian"}
          </span>
        </div>
      </div>
      {canManage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full rounded-xl"
          disabled={product.variants.length === 0}
          onClick={onBuy}
        >
          <ShoppingCart className="size-4" />
          {product.variants.length === 0 ? "Tambah varian dulu" : "Catat pembelian dari agen"}
        </Button>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 rounded-xl" asChild>
          <Link to="/catalog/$id" params={{ id: product.id }}>
            Kelola
          </Link>
        </Button>
        <Button
          size="sm"
          className="flex-1 rounded-xl"
          onClick={() => void navigate({ href: `/chat?send=${product.id}` })}
        >
          Kirim ke Pelanggan
        </Button>
      </div>
    </div>
  );
}

function Indicator({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-muted-foreground">{label}</p>
      <p className={`truncate font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
