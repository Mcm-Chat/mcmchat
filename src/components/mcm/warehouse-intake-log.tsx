import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { LoadingSkeleton } from "@/components/mcm/primitives";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import { listPurchases } from "@/lib/api/purchases";
import { formatWarehouseQty, type ProductWithVariants } from "@/lib/api/catalog";
import { rupiah } from "@/lib/mcm/format";

function dateLabel(v: string | null | undefined) {
  if (!v) return "-";
  return new Date(v).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function IntakeThumb({ path }: { path: string }) {
  const url = useSignedUrl("product-photos", path || null);
  if (!url) return null;
  return <img src={url} alt="Foto barang masuk" className="size-12 rounded-lg object-cover" />;
}

/** Riwayat barang masuk gudang beserta bukti foto dan link lokasi. */
export function WarehouseIntakeLog({
  product,
  businessId,
}: {
  product: ProductWithVariants;
  businessId: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog", "purchases", product.id],
    queryFn: () => listPurchases(businessId, product.id),
  });
  const rows = (data ?? []).slice(0, 8);

  return (
    <section className="card-soft space-y-2 p-3">
      <p className="text-[11px] font-semibold tracking-[0.04em] uppercase text-muted-foreground">
        Barang masuk gudang
      </p>
      {isLoading && <LoadingSkeleton rows={2} />}
      {!isLoading && rows.length === 0 && (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Belum ada catatan barang masuk.
        </p>
      )}
      {rows.map((p) => (
        <div key={p.id} className="flex gap-2 rounded-xl border border-border p-2.5 text-xs">
          <IntakeThumb path={p.photo_path} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-semibold">{p.supplier_name || "Agen tanpa nama"}</p>
              <p className="shrink-0 font-semibold text-primary">
                {rupiah(Number(p.total_cost))}
              </p>
            </div>
            <p className="text-muted-foreground">
              +{formatWarehouseQty(product, Number(p.qty_base))} · {dateLabel(p.purchased_at)}
            </p>
            {p.note && <p className="truncate italic text-muted-foreground">{p.note}</p>}
            {p.location_url && (
              <a
                href={p.location_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex h-7 max-w-full items-center gap-1 rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground"
              >
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{p.location_label || "Buka Lokasi"}</span>
              </a>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
