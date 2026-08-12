import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Boxes, Briefcase, Inbox, Megaphone, Package, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { InvoiceView, OrderCard, ProductCard, QuickReplyPicker } from "@/components/mcm/business-parts";
import { EmptyState, ProtoNote } from "@/components/mcm/primitives";
import { ProductGallery, ProductPhotoEditor } from "@/components/mcm/product-photos";
import { LedgerSummaryCard } from "@/components/mcm/ledger-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rupiah } from "@/lib/mcm/format";
import { isValidLocationUrl, orderTotal, reindexPhotos, uid, useMCM } from "@/lib/mcm/store";
import type { InboxStatus, Order, Product, ProductPhoto } from "@/lib/mcm/types";

export const Route = createFileRoute("/business/")({
  head: () => ({
    meta: [
      { title: "Bisnis — MCM" },
      { name: "description", content: "Kelola katalog produk, pesanan, invoice, dan balasan cepat untuk akun bisnis MCM Anda." },
      { property: "og:title", content: "Bisnis — MCM" },
      { property: "og:description", content: "Katalog, pesanan, dan invoice dalam satu tempat." },
    ],
  }),
  component: BusinessPage,
});

function BusinessPage() {
  const { state, update } = useMCM();
  const [product, setProduct] = useState<Product | null>(null);
  const [invoice, setInvoice] = useState<Order | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", category: "Umum", description: "" });
  const [formPhotos, setFormPhotos] = useState<ProductPhoto[]>([]);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ name: "", price: "", stock: "", description: "" });
  const [editPhotos, setEditPhotos] = useState<ProductPhoto[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("Semua");
  const [inboxFilter, setInboxFilter] = useState<"all" | InboxStatus>("all");

  const b = state.business;

  if (!b.active) {
    return (
      <AppShell header={<MobileHeader title="Bisnis" subtitle="Ubah akun jadi akun bisnis" />}>
        <div className="space-y-4 px-4 py-6">
          <EmptyState
            icon={Briefcase}
            title="Aktifkan akun bisnis"
            description="Tampilkan katalog produk, terima pesanan, kirim invoice, dan gunakan balasan cepat."
            action={
              <Button
                className="rounded-xl"
                onClick={() => {
                  update((d) => {
                    d.business.active = true;
                    return d;
                  });
                  toast.success("Akun bisnis aktif");
                }}
              >
                Aktifkan sekarang
              </Button>
            }
          />
          <ProtoNote>Fitur bisnis berjalan lokal sebagai MVP; pembayaran dan pengiriman nyata butuh integrasi lanjutan.</ProtoNote>
        </div>
      </AppShell>
    );
  }

  const omzet = state.orders.filter((o) => o.status !== "dibatalkan").reduce((s, o) => s + orderTotal(o), 0);
  const categories = ["Semua", ...Array.from(new Set(state.products.map((p) => p.category)))];
  const term = q.trim().toLowerCase();
  const visibleProducts = state.products.filter((p) => {
    if (cat !== "Semua" && p.category !== cat) return false;
    if (!term) return true;
    const haystack = [
      p.name,
      p.description,
      p.sku,
      ...(p.photos ?? []).flatMap((ph) => [ph.caption, ph.locationUrl]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
  const visibleInbox = state.inbox.filter((t) => inboxFilter === "all" || t.status === inboxFilter);

  const openEdit = (p: Product) => {
    setProduct(null);
    setEditing(p);
    setEditForm({ name: p.name, price: String(p.price), stock: String(p.stock), description: p.description });
    setEditPhotos(reindexPhotos([...(p.photos ?? [])]));
  };

  const saveEdit = () => {
    if (!editing) return;
    const price = Number(editForm.price);
    const stock = Number(editForm.stock);
    if (editForm.name.trim().length < 3) { toast.error("Nama produk minimal 3 karakter"); return; }
    if (!Number.isFinite(price) || price <= 0) { toast.error("Harga tidak valid"); return; }
    if (editPhotos.some((ph) => !isValidLocationUrl(ph.locationUrl))) { toast.error("Ada link lokasi yang tidak valid"); return; }
    update((d) => {
      const target = d.products.find((p) => p.id === editing.id);
      if (target) {
        target.name = editForm.name.trim();
        target.price = price;
        target.stock = Number.isFinite(stock) ? stock : target.stock;
        target.description = editForm.description.trim();
        target.photos = reindexPhotos(editPhotos).map((ph) => ({ ...ph, productId: target.id }));
      }
      return d;
    });
    setEditing(null);
    setEditPhotos([]);
    toast.success("Produk diperbarui");
  };

  const setThreadStatus = (id: string, status: InboxStatus) => {
    update((d) => {
      const t = d.inbox.find((x) => x.id === id);
      if (t) t.status = status;
      return d;
    });
    toast.success(`Percakapan ditandai ${status}`);
  };

  const addProduct = () => {
    const price = Number(form.price);
    if (form.name.trim().length < 3) { toast.error("Nama produk minimal 3 karakter"); return; }
    if (!Number.isFinite(price) || price <= 0) { toast.error("Harga tidak valid"); return; }
    if (formPhotos.some((ph) => !isValidLocationUrl(ph.locationUrl))) { toast.error("Ada link lokasi yang tidak valid"); return; }
    const newId = uid("pr");
    update((d) => {
      d.products.unshift({
        id: newId,
        name: form.name.trim(),
        category: form.category,
        price,
        discountPercent: 0,
        sku: `SKU-${Math.floor(Math.random() * 9000 + 1000)}`,
        stock: 10,
        description: form.description.trim(),
        active: true,
        emoji: "📦",
        variants: [],
        photos: reindexPhotos(formPhotos).map((ph) => ({ ...ph, productId: newId })),
      });
      return d;
    });
    setAddOpen(false);
    setForm({ name: "", price: "", category: "Umum", description: "" });
    setFormPhotos([]);
    toast.success("Produk ditambahkan");
  };

  return (
    <AppShell header={<MobileHeader title={b.name} subtitle={`${b.category} • PIN ${b.pin}`} />}>
      <div className="space-y-4 px-4 py-4 pb-24">
        <div className="grid grid-cols-2 gap-2">
          <LedgerSummaryCard label="Omzet" value={rupiah(omzet)} hint="Semua pesanan aktif" tone="success" />
          <LedgerSummaryCard label="Pesanan baru" value={`${state.orders.filter((o) => o.status === "baru").length}`} tone="warning" />
        </div>

        <Tabs defaultValue="katalog">
          <TabsList className="w-full rounded-xl">
            <TabsTrigger value="katalog" className="flex-1 rounded-lg text-xs">
              Katalog
            </TabsTrigger>
            <TabsTrigger value="pesanan" className="flex-1 rounded-lg text-xs">
              Pesanan
            </TabsTrigger>
            <TabsTrigger value="balasan" className="flex-1 rounded-lg text-xs">
              Balasan
            </TabsTrigger>
            <TabsTrigger value="inbox" className="flex-1 rounded-lg text-xs">
              Inbox
            </TabsTrigger>
          </TabsList>

          <TabsContent value="katalog" className="mt-4 space-y-3">
            <Button className="w-full rounded-xl" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Tambah produk
            </Button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari produk, keterangan, atau link lokasi"
                className="h-11 rounded-xl pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCat(c)}
                  className={`rounded-full border px-3 py-1 text-xs ${c === cat ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            {visibleProducts.length === 0 ? (
              <EmptyState icon={Boxes} title="Katalog kosong" description="Tambahkan produk pertama Anda agar pelanggan bisa memesan." />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {visibleProducts.map((p) => (
                  <ProductCard key={p.id} product={p} onClick={() => setProduct(p)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="pesanan" className="mt-4 space-y-3">
            {state.orders.length === 0 ? (
              <EmptyState icon={Package} title="Belum ada pesanan" description="Pesanan dari pelanggan akan muncul di sini." />
            ) : (
              state.orders.map((o) => (
                <button key={o.id} type="button" className="w-full text-left" onClick={() => setInvoice(o)}>
                  <OrderCard order={o} />
                </button>
              ))
            )}
          </TabsContent>

          <TabsContent value="balasan" className="mt-4 space-y-3">
            <QuickReplyPicker replies={b.quickReplies} onPick={(t) => { void navigator.clipboard.writeText(t); toast.success("Balasan disalin"); }} />
            <div className="card-soft space-y-2 p-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Megaphone className="size-4" /> Siaran
              </p>
              {b.broadcastOptIn.length} pelanggan menyetujui menerima siaran.
              <Button variant="outline" className="w-full rounded-xl" onClick={() => toast.success("Siaran terkirim ke pelanggan opt-in")}>
                Kirim siaran
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="inbox" className="mt-4 space-y-3">
            <div className="flex gap-2">
              {(["all", "open", "pending", "closed"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setInboxFilter(f)}
                  className={`rounded-full border px-3 py-1 text-xs capitalize ${f === inboxFilter ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
                >
                  {f === "all" ? "Semua" : f}
                </button>
              ))}
            </div>
            {visibleInbox.length === 0 ? (
              <EmptyState icon={Inbox} title="Inbox kosong" description="Percakapan pelanggan akan muncul di sini." />
            ) : (
              visibleInbox.map((t) => (
                <div key={t.id} className="card-soft space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{t.customerName}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{t.status}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{t.preview}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Label {t.label} • Ditugaskan ke {t.assignee}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 rounded-lg text-xs" onClick={() => setThreadStatus(t.id, "pending")}>
                      Pending
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 rounded-lg text-xs" onClick={() => setThreadStatus(t.id, "open")}>
                      Open
                    </Button>
                    <Button size="sm" className="flex-1 rounded-lg text-xs" onClick={() => setThreadStatus(t.id, "closed")}>
                      Selesai
                    </Button>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>

        <ProtoNote>Pembayaran, ongkir, dan sinkronisasi stok nyata memerlukan integrasi backend.</ProtoNote>
      </div>

      <Dialog open={!!product} onOpenChange={(v) => !v && setProduct(null)}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>{product?.name}</DialogTitle>
          </DialogHeader>
          {product && (
            <div className="space-y-2 text-sm">
              <p className="text-lg font-bold">{rupiah(product.price)}</p>
              <p className="text-muted-foreground">{product.description}</p>
              <p className="text-xs text-muted-foreground">SKU {product.sku} • stok {product.stock}</p>
              <Button className="w-full rounded-xl" onClick={() => openEdit(product)}>
                Edit produk
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit produk</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="en">Nama produk</Label>
              <Input id="en" maxLength={60} value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ep">Harga (Rp)</Label>
                <Input id="ep" inputMode="numeric" maxLength={12} value={editForm.price} onChange={(e) => setEditForm((p) => ({ ...p, price: e.target.value.replace(/\D/g, "") }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="es">Stok</Label>
                <Input id="es" inputMode="numeric" maxLength={6} value={editForm.stock} onChange={(e) => setEditForm((p) => ({ ...p, stock: e.target.value.replace(/\D/g, "") }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed">Deskripsi</Label>
              <Textarea id="ed" maxLength={200} value={editForm.description} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <Button className="w-full rounded-xl" onClick={saveEdit}>
              Simpan perubahan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!invoice} onOpenChange={(v) => !v && setInvoice(null)}>
        <DialogContent className="max-h-[85vh] max-w-[360px] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle>Invoice</DialogTitle>
          </DialogHeader>
          {invoice && <InvoiceView order={invoice} business={b} />}
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Tambah produk</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pn">Nama produk</Label>
              <Input id="pn" maxLength={60} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp">Harga (Rp)</Label>
              <Input id="pp" inputMode="numeric" maxLength={12} value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value.replace(/\D/g, "") }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd">Deskripsi</Label>
              <Textarea id="pd" maxLength={200} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <Button className="w-full rounded-xl" onClick={addProduct}>
              Simpan produk
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
