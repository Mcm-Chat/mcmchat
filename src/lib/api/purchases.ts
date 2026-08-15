import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type PurchaseRow = Tables<"purchases">;

export type PurchaseInput = {
  variantId: string;
  supplierName: string;
  supplierContact: string;
  qtyBase: number;
  displayQty: number;
  displayUnit: string;
  unitCost: number;
  totalCost: number;
  note: string;
  purchasedAt?: string | null;
};

/** Catat pembelian dari agen + tambah stok varian dalam satu transaksi RPC. */
export async function recordPurchase(input: PurchaseInput): Promise<string> {
  const payload = {
    variant_id: input.variantId,
    supplier_name: input.supplierName,
    supplier_contact: input.supplierContact,
    qty_base: input.qtyBase,
    display_qty: input.displayQty,
    display_unit: input.displayUnit,
    unit_cost: input.unitCost,
    total_cost: input.totalCost,
    note: input.note,
    purchased_at: input.purchasedAt ?? null,
  };
  const { data, error } = await supabase.rpc("record_purchase", { _payload: payload as never });
  if (error) throw new Error(friendly(error.message, "Gagal mencatat pembelian"));
  return data as unknown as string;
}

export async function listPurchases(businessId: string, productId?: string) {
  let q = supabase
    .from("purchases")
    .select("*")
    .eq("business_id", businessId)
    .order("purchased_at", { ascending: false })
    .limit(100);
  if (productId) q = q.eq("product_id", productId);
  return unwrap(await q, "Gagal memuat riwayat pembelian");
}

export async function deletePurchase(id: string) {
  const { error } = await supabase.from("purchases").delete().eq("id", id);
  if (error) throw new Error(friendly(error.message, "Gagal menghapus pembelian"));
}

export type ProductIndicator = {
  product_id: string;
  total_cost: number;
  total_qty_base: number;
  avg_cost_base: number;
  stock_base: number;
  stock_value: number;
  sold_base: number;
  sold_revenue: number;
  profit: number;
  last_supplier: string;
  last_purchase_at: string | null;
};

export async function productIndicators(businessId: string): Promise<ProductIndicator[]> {
  const { data, error } = await supabase.rpc("catalog_product_indicators", {
    _business: businessId,
  });
  if (error) throw new Error(friendly(error.message, "Gagal memuat indikator katalog"));
  return (data ?? []).map((r) => ({
    product_id: r.product_id as string,
    total_cost: Number(r.total_cost ?? 0),
    total_qty_base: Number(r.total_qty_base ?? 0),
    avg_cost_base: Number(r.avg_cost_base ?? 0),
    stock_base: Number(r.stock_base ?? 0),
    stock_value: Number(r.stock_value ?? 0),
    sold_base: Number(r.sold_base ?? 0),
    sold_revenue: Number(r.sold_revenue ?? 0),
    profit: Number(r.profit ?? 0),
    last_supplier: String(r.last_supplier ?? ""),
    last_purchase_at: (r.last_purchase_at as string | null) ?? null,
  }));
}

/** Ganti nama kategori (folder). Kirim tujuan kosong untuk memindahkan ke "Umum". */
export async function renameCategory(businessId: string, from: string, to: string) {
  const { data, error } = await supabase.rpc("rename_product_category", {
    _business: businessId,
    _from: from,
    _to: to,
  });
  if (error) throw new Error(friendly(error.message, "Gagal mengubah kategori"));
  return Number(data ?? 0);
}
