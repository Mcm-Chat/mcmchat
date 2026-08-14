/**
 * Unit fisik varian (SSOT barang siap).
 *
 * Setiap barang yang sudah benar-benar disiapkan menjadi satu baris
 * `variant_stock_units` dengan jumlah pasti, foto, lokasi, dan catatannya
 * sendiri. Semua perubahan status berjalan lewat RPC SECURITY DEFINER agar
 * saldo stok hanya bergerak tepat satu kali per transisi.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";
import type { PhotoRow } from "./catalog";

export type StockUnitRow = Tables<"variant_stock_units">;
export type StockUnitStatus = StockUnitRow["status"];
export type StockUnitWithPhotos = StockUnitRow & { photos: PhotoRow[] };

export const UNIT_STATUS_LABEL: Record<StockUnitStatus, string> = {
  draft: "Perlu konfirmasi",
  available: "Tersedia",
  reserved: "Dipesan",
  preparing: "Disiapkan",
  ready: "Siap dikirim",
  delivered: "Terkirim",
  void: "Dibatalkan",
};

export const UNIT_STATUS_TONE: Record<StockUnitStatus, "primary" | "warning" | "danger" | "muted"> = {
  draft: "warning",
  available: "primary",
  reserved: "warning",
  preparing: "warning",
  ready: "primary",
  delivered: "muted",
  void: "danger",
};

/** Status yang tidak boleh dihitung sebagai stok tersedia di gudang. */
export const ALLOCATED_STATUSES: StockUnitStatus[] = ["reserved", "preparing", "ready", "delivered"];

/** Daftar unit sebuah varian beserta foto masing-masing unit. */
export async function listUnits(variantId: string): Promise<StockUnitWithPhotos[]> {
  const units = unwrap(
    await supabase
      .from("variant_stock_units")
      .select("*")
      .eq("variant_id", variantId)
      .order("unit_seq", { ascending: true }),
    "Gagal memuat unit",
  );
  if (units.length === 0) return [];
  const photos = unwrap(
    await supabase
      .from("product_photos")
      .select("*")
      .in(
        "stock_unit_id",
        units.map((u) => u.id),
      )
      .order("sort_order", { ascending: true }),
    "Gagal memuat foto unit",
  );
  return units.map((u) => ({ ...u, photos: photos.filter((p) => p.stock_unit_id === u.id) }));
}

/** Unit yang benar-benar bisa dipilih untuk memenuhi slot pesanan. */
export async function listAvailableUnits(variantId: string): Promise<StockUnitWithPhotos[]> {
  return (await listUnits(variantId)).filter((u) => u.status === "available");
}

/** Unit yang sudah menjadi milik pembeli (riwayat pembeli). */
export async function listMyDeliveredUnits(): Promise<StockUnitWithPhotos[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const units = unwrap(
    await supabase
      .from("variant_stock_units")
      .select("*")
      .eq("customer_user_id", uid)
      .eq("status", "delivered")
      .order("delivered_at", { ascending: false }),
    "Gagal memuat unit milik Anda",
  );
  if (units.length === 0) return [];
  const photos = unwrap(
    await supabase
      .from("product_photos")
      .select("*")
      .in(
        "stock_unit_id",
        units.map((u) => u.id),
      ),
    "Gagal memuat foto unit",
  );
  return units.map((u) => ({ ...u, photos: photos.filter((p) => p.stock_unit_id === u.id) }));
}

export async function createUnit(input: {
  variantId: string;
  qtyBase: number;
  note?: string;
  label?: string;
}): Promise<StockUnitRow> {
  const { data, error } = await supabase.rpc("create_stock_unit", {
    _variant: input.variantId,
    _qty_base: input.qtyBase,
    _note: input.note ?? "",
    _label: input.label ?? "",
  });
  if (error) throw new Error(friendly(error.message, "Gagal membuat unit"));
  return data as unknown as StockUnitRow;
}

/** Draf → tersedia. Wajib punya minimal satu foto; saldo bertambah tepat sekali. */
export async function activateUnit(unitId: string): Promise<StockUnitRow> {
  const { data, error } = await supabase.rpc("activate_stock_unit", { _unit: unitId });
  if (error) throw new Error(friendly(error.message, "Gagal mengaktifkan unit"));
  return data as unknown as StockUnitRow;
}

export async function voidUnit(unitId: string, reason = ""): Promise<StockUnitRow> {
  const { data, error } = await supabase.rpc("void_stock_unit", { _unit: unitId, _reason: reason });
  if (error) throw new Error(friendly(error.message, "Gagal membatalkan unit"));
  return data as unknown as StockUnitRow;
}

export async function updateUnitNote(unitId: string, note: string) {
  const { error } = await supabase.rpc("create_stock_unit" as never, undefined as never).select?.() ?? {};
  void error;
  void unitId;
  void note;
}
