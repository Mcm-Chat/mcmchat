import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSkeleton } from "@/components/mcm/primitives";
import { listProductMovements, listPurchases, type ProductIndicator } from "@/lib/api/purchases";
import {
  MOVEMENT_LABEL,
  formatQty,
  formatWarehouseQty,
  type ProductWithVariants,
} from "@/lib/api/catalog";
import { rupiah } from "@/lib/mcm/format";
import { useSignedUrl } from "@/lib/api/use-signed-url";

export type IndicatorFocus = "cost" | "stock" | "sold" | "profit" | "supplier";

const FOCUS_TITLE: Record<IndicatorFocus, string> = {
  cost: "Modal masuk",
  stock: "Nilai stok",
  sold: "Terjual",
  profit: "Estimasi laba",
  supplier: "Agen terakhir",
};

function dateLabel(v: string | null | undefined) {
  if (!v) return "-";
  return new Date(v).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function ProductInsightDialog({
  open,
  onOpenChange,
  product,
  indicator,
  businessId,
  focus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: ProductWithVariants;
  indicator?: ProductIndicator | undefined;
  businessId: string;
  focus: IndicatorFocus;
}) {
  const { data: purchases, isLoading: loadingPurchases } = useQuery({
    queryKey: ["catalog", "purchases", product.id],
    queryFn: () => listPurchases(businessId, product.id),
    enabled: open,
  });
  const { data: movements, isLoading: loadingMovements } = useQuery({
    queryKey: ["catalog", "movements", product.id],
    queryFn: () => listProductMovements(product.id),
    enabled: open,
  });

  const variantById = new Map(product.variants.map((v) => [v.id, v]));
  const fmt = (variantId: string | null, qty: number) => {
    const v = variantId ? variantById.get(variantId) : undefined;
    if (v) return formatQty(v, qty);
    // Pergerakan tingkat gudang: tampilkan dalam satuan dasar gudang.
    return formatWarehouseQty(product, qty);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {FOCUS_TITLE[focus]} — {product.name}
          </DialogTitle>
          <DialogDescription>
            Rincian pembelian dari agen dan mutasi stok yang membentuk angka ini.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-[11px]">
          <Cell label="Modal masuk" value={rupiah(indicator?.total_cost ?? 0)} />
          <Cell label="Nilai stok" value={rupiah(indicator?.stock_value ?? 0)} />
          <Cell
            label="Terjual"
            value={
              product.variants[0] && indicator
                ? formatQty(product.variants[0], indicator.sold_base)
                : "0"
            }
          />
          <Cell label="Omzet" value={rupiah(indicator?.sold_revenue ?? 0)} />
          <Cell
            label="Estimasi laba"
            value={rupiah(indicator?.profit ?? 0)}
            tone={(indicator?.profit ?? 0) >= 0 ? "text-success" : "text-destructive"}
          />
          <Cell label="Agen terakhir" value={indicator?.last_supplier || "Belum ada"} />
        </div>

        <Tabs defaultValue={focus === "sold" || focus === "profit" ? "movements" : "purchases"}>
          <TabsList className="grid w-full grid-cols-2 rounded-xl">
            <TabsTrigger value="purchases">Pembelian</TabsTrigger>
            <TabsTrigger value="movements">Mutasi stok</TabsTrigger>
          </TabsList>

          <TabsContent value="purchases" className="space-y-2 pt-3">
            {loadingPurchases && <LoadingSkeleton rows={3} />}
            {!loadingPurchases && (purchases ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada pembelian tercatat.
              </p>
            )}
            {(purchases ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border border-border p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{p.supplier_name || "Agen tanpa nama"}</p>
                  <p className="shrink-0 font-semibold text-primary">
                    {rupiah(Number(p.total_cost))}
                  </p>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {fmt(p.variant_id, Number(p.qty_base))} · {rupiah(Number(p.unit_cost))} /{" "}
                  {p.display_unit || "satuan"}
                </p>
                <p className="text-muted-foreground">{dateLabel(p.purchased_at)}</p>
                {p.supplier_contact && (
                  <p className="text-muted-foreground">Kontak: {p.supplier_contact}</p>
                )}
                {p.note && <p className="mt-1 italic text-muted-foreground">{p.note}</p>}
                <PurchaseEvidence
                  photoPath={p.photo_path}
                  locationUrl={p.location_url}
                  locationLabel={p.location_label}
                />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="movements" className="space-y-2 pt-3">
            {loadingMovements && <LoadingSkeleton rows={3} />}
            {!loadingMovements && (movements ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada mutasi stok.
              </p>
            )}
            {(movements ?? []).map((m) => {
              const qty = Number(m.qty_base);
              return (
                <div key={m.id} className="rounded-xl border border-border p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{MOVEMENT_LABEL[m.movement_type]}</p>
                    <p
                      className={`shrink-0 font-semibold ${qty >= 0 ? "text-success" : "text-destructive"}`}
                    >
                      {qty >= 0 ? "+" : "−"}
                      {fmt(m.variant_id, Math.abs(qty))}
                    </p>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Sisa: {fmt(m.variant_id, Number(m.balance_after))}
                  </p>
                  <p className="text-muted-foreground">{dateLabel(m.created_at)}</p>
                  {m.note && <p className="mt-1 italic text-muted-foreground">{m.note}</p>}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-muted-foreground">{label}</p>
      <p className={`truncate font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function PurchaseEvidence({
  photoPath,
  locationUrl,
  locationLabel,
}: {
  photoPath: string;
  locationUrl: string;
  locationLabel: string;
}) {
  const url = useSignedUrl("product-photos", photoPath || null);
  if (!photoPath && !locationUrl) return null;
  return (
    <div className="mt-2 flex items-center gap-2">
      {url && (
        <img src={url} alt="Foto barang masuk" className="size-14 rounded-lg object-cover" />
      )}
      {locationUrl && (
        <a
          href={locationUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 min-w-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[11px] font-medium text-primary-foreground"
        >
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{locationLabel || "Buka Lokasi"}</span>
        </a>
      )}
    </div>
  );
}

