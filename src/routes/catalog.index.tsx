import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { EmptyState, LoadingSkeleton } from "@/components/mcm/primitives";
import { ProductThumb, StockChip, priceLabel } from "@/components/mcm/catalog-parts";
import { AiDescriptionButton } from "@/components/mcm/ai-description";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useRequireAuth } from "@/lib/api/guard";
import { useMyBusiness } from "@/lib/api/queries";
import { createBusiness } from "@/lib/api/business";
import { listCatalog, upsertProduct, type ProductWithVariants } from "@/lib/api/catalog";
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
  const [form, setForm] = useState({ name: "", price: "", category: "Umum", description: "" });

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
    try {
      const created = await upsertProduct({
        business_id: businessId!,
        name: form.name.trim(),
        category: form.category.trim() || "Umum",
        description: form.description.trim(),
        price,
      });
      setAddOpen(false);
      setForm({ name: "", price: "", category: "Umum", description: "" });
      void qc.invalidateQueries({ queryKey: ["catalog", "products", businessId] });
      toast.success("Produk dibuat");
      void navigate({ to: "/catalog/$id", params: { id: created.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat produk");
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
              <DialogContent className="rounded-2xl">
                <DialogHeader>
                  <DialogTitle>Produk baru</DialogTitle>
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
                </div>
                <DialogFooter>
                  <Button className="w-full rounded-xl" onClick={submitProduct}>
                    Simpan & tambah varian
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
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
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
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function ProductCard({ product }: { product: ProductWithVariants }) {
  const navigate = useNavigate();
  const cover = product.photos[0]?.image_path;
  return (
    <div className="card-soft space-y-3 p-3">
      <Link to="/catalog/$id" params={{ id: product.id }} className="flex gap-3">
        <ProductThumb path={cover} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{product.name}</p>
          <p className="text-xs text-muted-foreground">{product.category}</p>
          <p className="mt-1 text-sm font-semibold text-primary">
            {priceLabel(Number(product.price))}
          </p>
        </div>
      </Link>
      {product.variants.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {product.variants.map((v) => (
            <StockChip key={v.id} variant={v} balance={v.balance} />
          ))}
        </div>
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
