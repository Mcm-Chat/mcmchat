import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { rupiah } from "@/lib/mcm/format";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import {
  listCatalog,
  toBase,
  WEIGHT_UNITS,
  COUNT_UNITS,
  type ProductWithVariants,
  type VariantRow,
  type PhotoRow,
} from "@/lib/api/catalog";
import {
  computeTotals,
  createSale,
  PAYMENT_LABEL,
  validateSale,
  type PaymentMethod,
  type SaleItemInput,
} from "@/lib/api/sales";
import type { ContactWithProfile } from "@/lib/api/contacts";

type CartItem = SaleItemInput & { key: string };

function PhotoThumb({
  path,
  selected,
  onClick,
}: {
  path: string;
  selected: boolean;
  onClick: () => void;
}) {
  const url = useSignedUrl("product-photos", path);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative size-16 shrink-0 overflow-hidden rounded-xl border-2",
        selected ? "border-primary" : "border-border",
      )}
    >
      {url ? (
        <img src={url} alt="Foto produk" className="size-full object-cover" />
      ) : (
        <div className="size-full animate-pulse bg-muted" />
      )}
      {selected && (
        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      )}
    </button>
  );
}

export function SaleDialog({
  open,
  onOpenChange,
  businessId,
  sellerId,
  conversationId,
  customerUserId,
  customerName,
  contacts,
  presetProductId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  sellerId: string;
  conversationId?: string | null;
  customerUserId?: string | null;
  customerName?: string;
  contacts?: ContactWithProfile[];
  presetProductId?: string | null;
  onSuccess?: (result: { conversationId: string | null; already: boolean }) => void;
}) {
  const contactRequired = !conversationId;
  const {
    data: catalog,
    isLoading: catalogLoading,
    error: catalogError,
    refetch,
  } = useQuery({
    queryKey: ["catalog-sale", businessId],
    queryFn: () => listCatalog(businessId),
    enabled: !!businessId && open,
  });

  const [contactId, setContactId] = useState<string>(customerUserId ?? "");
  const [items, setItems] = useState<CartItem[]>([]);
  const [q, setQ] = useState("");
  const [productId, setProductId] = useState<string | null>(presetProductId ?? null);
  const [variantId, setVariantId] = useState<string>("");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [itemDiscount, setItemDiscount] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [extraFee, setExtraFee] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (open) idemKey.current = crypto.randomUUID();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setProductId(presetProductId ?? null);
      setVariantId("");
      setSelectedPhotoIds([]);
      setQty("1");
      setUnit("");
      setPrice("");
      setItemDiscount("0");
      setDiscount("0");
      setExtraFee("0");
      setPaymentMethod("cash");
      setPaidAmount("");
      setDueDate("");
      setNote("");
      setContactId(customerUserId ?? "");
    }
  }, [open, presetProductId, customerUserId]);

  const products = catalog ?? [];
  const filtered = useMemo(
    () => products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())),
    [products, q],
  );
  const product = products.find((p) => p.id === productId) ?? null;
  const variant = product?.variants.find((v) => v.id === variantId) ?? null;
  const unitOptions = variant
    ? variant.stock_type === "weight"
      ? [...WEIGHT_UNITS]
      : [...COUNT_UNITS]
    : [];
  const activeUnit = unit || variant?.display_unit || unitOptions[0] || "pcs";

  useEffect(() => {
    if (product && product.variants.length === 1) setVariantId(product.variants[0]!.id);
  }, [product]);

  useEffect(() => {
    if (variant) {
      setPrice(String(Number(variant.price)));
      setUnit(variant.display_unit || (variant.stock_type === "weight" ? "g" : "pcs"));
    }
  }, [variant]);

  const resolvedContact = (contacts ?? []).find((c) => c.contact_id === contactId);
  const finalCustomerName = customerName || resolvedContact?.profile.display_name || "Pelanggan";
  const finalCustomerUserId = conversationId ? (customerUserId ?? null) : contactId || null;

  const addItem = () => {
    if (!product || !variant) {
      toast.error("Pilih produk dan varian dulu");
      return;
    }
    const n = Number(qty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Jumlah harus lebih dari nol");
      return;
    }
    if (variant.stock_type === "count" && !variant.allow_decimal && !Number.isInteger(n)) {
      toast.error(`${variant.name} hanya menerima jumlah bulat`);
      return;
    }
    const p = Number(price.replace(/\D/g, ""));
    if (!Number.isFinite(p) || p < 0) {
      toast.error("Harga tidak valid");
      return;
    }
    const disc = Number(itemDiscount.replace(/\D/g, "")) || 0;
    let qtyBase = 0;
    try {
      qtyBase = toBase(variant, n, activeUnit);
    } catch {
      toast.error("Satuan tidak dikenal untuk varian ini");
      return;
    }
    const selectedPhotos = (product.photos ?? []).filter((ph) => selectedPhotoIds.includes(ph.id));
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        variantName: variant.name,
        unit: activeUnit,
        price: p,
        qty: n,
        qtyBase,
        discount: disc,
        photoIds: selectedPhotos.map((ph) => ph.id),
        photos: selectedPhotos.map((ph) => ({
          id: ph.id,
          location_url: ph.location_url,
          location_lat: ph.location_lat,
          location_lng: ph.location_lng,
          location_label: ph.location_label,
        })),
      },
    ]);
    setProductId(null);
    setVariantId("");
    setSelectedPhotoIds([]);
    setQty("1");
    setPrice("");
    setItemDiscount("0");
    setQ("");
    toast.success("Item ditambahkan ke keranjang");
  };

  const removeItem = (key: string) => setItems((p) => p.filter((i) => i.key !== key));

  const totals = computeTotals(items, Number(discount) || 0, Number(extraFee) || 0);
  const paid =
    paymentMethod === "cash" || paymentMethod === "transfer"
      ? totals.total
      : Number(paidAmount.replace(/\D/g, "")) || 0;
  const outstanding = Math.max(0, totals.total - paid);

  useEffect(() => {
    if (paymentMethod === "cash" || paymentMethod === "transfer")
      setPaidAmount(String(totals.total));
  }, [paymentMethod, totals.total]);

  const submit = async () => {
    if (contactRequired && !contactId) {
      toast.error("Pilih kontak pelanggan dulu");
      return;
    }
    const errors = validateSale({
      items,
      discount: Number(discount) || 0,
      extraFee: Number(extraFee) || 0,
      paymentMethod,
      paidAmount: paid,
      dueDate: dueDate || null,
    });
    if (errors.length > 0) {
      toast.error(errors[0]!);
      return;
    }
    setSubmitting(true);
    try {
      let convId = conversationId ?? null;
      if (!convId && contactId) {
        const { getOrCreateDirect } = await import("@/lib/api/chat");
        convId = await getOrCreateDirect(sellerId, contactId);
      }
      const record = await createSale({
        businessId,
        sellerId,
        idempotencyKey: idemKey.current,
        items,
        discount: Number(discount) || 0,
        extraFee: Number(extraFee) || 0,
        paymentMethod,
        paidAmount: paid,
        dueDate: paymentMethod === "dp" || paymentMethod === "credit" ? dueDate || null : null,
        note,
        customerName: finalCustomerName,
        customerUserId: finalCustomerUserId,
        conversationId: convId,
      });
      toast.success("Penjualan tercatat");
      onOpenChange(false);
      onSuccess?.({ conversationId: convId ?? record.conversation_id, already: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat penjualan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>Catat penjualan</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
          {contactRequired && (
            <section className="space-y-1.5">
              <Label>Pelanggan</Label>
              <Select value={contactId} onValueChange={setContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kontak" />
                </SelectTrigger>
                <SelectContent>
                  {(contacts ?? []).map((c) => (
                    <SelectItem key={c.contact_id} value={c.contact_id}>
                      {c.profile.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(contacts ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Belum ada kontak. Tambah kontak dulu.
                </p>
              )}
            </section>
          )}
          {!contactRequired && (
            <p className="rounded-xl bg-muted px-3 py-2 text-xs">
              Penjualan untuk <span className="font-semibold">{finalCustomerName}</span>
            </p>
          )}

          <section className="space-y-2 rounded-2xl border border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground">Tambah item</p>
            {catalogLoading ? (
              <p className="text-xs text-muted-foreground">Memuat katalog…</p>
            ) : catalogError ? (
              <div className="space-y-1.5 text-xs text-destructive">
                <p>Gagal memuat katalog.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-lg text-xs"
                  onClick={() => void refetch()}
                >
                  Coba lagi
                </Button>
              </div>
            ) : products.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada produk di katalog.</p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Cari produk"
                    className="h-9 rounded-xl pl-8 text-sm"
                  />
                </div>
                <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProductId(p.id);
                        setVariantId("");
                        setSelectedPhotoIds([]);
                      }}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs",
                        productId === p.id
                          ? "bg-primary/10 font-semibold text-primary"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {rupiah(Number(p.price))}
                      </span>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="px-2 py-2 text-xs text-muted-foreground">Tidak ada hasil.</p>
                  )}
                </div>

                {product && (
                  <div className="space-y-3 rounded-xl bg-muted/40 p-2.5">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Varian</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {product.variants.map((v: VariantRow) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setVariantId(v.id)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs",
                              variantId === v.id
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                          >
                            {v.name}
                          </button>
                        ))}
                        {product.variants.length === 0 && (
                          <p className="text-xs text-muted-foreground">Belum ada varian.</p>
                        )}
                      </div>
                    </div>

                    {product.photos.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Foto produk (pilih satu atau beberapa)</Label>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {product.photos.map((ph: PhotoRow) => (
                            <PhotoThumb
                              key={ph.id}
                              path={ph.image_path}
                              selected={selectedPhotoIds.includes(ph.id)}
                              onClick={() =>
                                setSelectedPhotoIds((prev) =>
                                  prev.includes(ph.id)
                                    ? prev.filter((x) => x !== ph.id)
                                    : [...prev, ph.id],
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {variant && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Jumlah</Label>
                            <Input
                              inputMode="decimal"
                              value={qty}
                              onChange={(e) => setQty(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Satuan</Label>
                            <Select value={activeUnit} onValueChange={setUnit}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {unitOptions.map((u) => (
                                  <SelectItem key={u} value={u}>
                                    {u}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Harga jual</Label>
                            <Input
                              inputMode="numeric"
                              value={price}
                              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Diskon item</Label>
                            <Input
                              inputMode="numeric"
                              value={itemDiscount}
                              onChange={(e) => setItemDiscount(e.target.value.replace(/\D/g, ""))}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="w-full rounded-lg text-xs"
                          onClick={addItem}
                        >
                          <Plus className="size-3.5" /> Tambah ke keranjang
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {items.length > 0 && (
            <section className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Keranjang</p>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <li
                    key={it.key}
                    className="flex items-center gap-2 rounded-xl bg-muted px-2.5 py-2 text-xs"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {it.name} — {it.variantName}
                      </span>
                      <span className="block text-muted-foreground">
                        {it.qty} {it.unit} × {rupiah(it.price)}{" "}
                        {it.discount > 0 ? `(−${rupiah(it.discount)})` : ""}
                        {it.photoIds.length > 0 ? ` • ${it.photoIds.length} foto` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold">
                      {rupiah(Math.max(0, it.price - it.discount) * it.qty)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Hapus item"
                      onClick={() => removeItem(it.key)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Ongkir / biaya lain</Label>
              <Input
                inputMode="numeric"
                value={extraFee}
                onChange={(e) => setExtraFee(e.target.value.replace(/\D/g, ""))}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Diskon total</Label>
              <Input
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(e.target.value.replace(/\D/g, ""))}
                className="h-9 text-sm"
              />
            </div>
          </section>

          <section className="space-y-2">
            <Label className="text-xs">Metode pembayaran</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PAYMENT_LABEL).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {paymentMethod === "dp" && (
              <div className="space-y-1">
                <Label className="text-xs">Jumlah dibayar (DP)</Label>
                <Input
                  inputMode="numeric"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value.replace(/\D/g, ""))}
                  className="h-9 text-sm"
                />
              </div>
            )}
            {(paymentMethod === "dp" || paymentMethod === "credit") && (
              <div className="space-y-1">
                <Label className="text-xs">Jatuh tempo</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
            )}
          </section>

          <section className="space-y-1">
            <Label className="text-xs">Catatan</Label>
            <Textarea
              value={note}
              maxLength={300}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none rounded-xl text-sm"
            />
          </section>

          <section className="space-y-1 rounded-2xl border border-border p-3 text-xs">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Ringkasan</p>
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{rupiah(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Diskon</span>
              <span>−{rupiah(Number(discount) || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Ongkir/biaya</span>
              <span>{rupiah(Number(extraFee) || 0)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <span>Total</span>
              <span>{rupiah(totals.total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Dibayar</span>
              <span>{rupiah(paid)}</span>
            </div>
            {outstanding > 0 && (
              <div className="flex justify-between font-semibold text-warning">
                <span>Sisa</span>
                <span>{rupiah(outstanding)}</span>
              </div>
            )}
          </section>
        </div>
        <DialogFooter className="border-t border-border px-4 py-3">
          <Button
            className="w-full rounded-xl"
            disabled={submitting || items.length === 0}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{" "}
            Kirim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
