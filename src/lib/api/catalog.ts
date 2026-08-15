import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { removeObject, uploadProductPhoto } from "./storage";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  COUNT_UNIT_LIST,
  VARIANT_MESSAGES,
  WEIGHT_UNIT_LIST,
  WEIGHT_UNIT_TO_GRAM,
  decimalMultiply,
  toNumericString,
  validateVariantDraft,
  type VariantDraft,
} from "@/lib/mcm/decimal";

export type ProductRow = Tables<"products">;
export type VariantRow = Tables<"product_variants">;
export type BalanceRow = Tables<"inventory_balances">;
export type MovementRow = Tables<"inventory_movements">;
export type PhotoRow = Tables<"product_photos">;
export type StockType = VariantRow["stock_type"];
export type MovementType = MovementRow["movement_type"];

export const WEIGHT_UNITS = WEIGHT_UNIT_LIST;
export const COUNT_UNITS = COUNT_UNIT_LIST;
export const WEIGHT_TO_BASE_G = WEIGHT_UNIT_TO_GRAM;

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  preparation: "Penyiapan",
  sale: "Penjualan",
  adjustment: "Koreksi",
  restock: "Tambah stok",
  return: "Retur",
};

/** Konversi jumlah + satuan ke qty_base, mengikuti aturan yang sama dengan fungsi DB convert_to_base. */
export function toBase(
  variant: Pick<VariantRow, "stock_type" | "conversion_factor">,
  qty: number,
  unit: string,
): number {
  if (variant.stock_type === "weight") {
    const factor = WEIGHT_TO_BASE_G[unit as keyof typeof WEIGHT_TO_BASE_G];
    if (!factor) throw new Error(VARIANT_MESSAGES.unit);
    // Presisi gram 6 desimal: 0,01 g dan 1 mg tidak boleh dibulatkan hilang.
    return decimalMultiply(qty, factor);
  }
  // Hitungan selalu bilangan bulat base unit; tidak pernah dikonversi ke gram.
  return Math.round(qty * (variant.conversion_factor || 1));
}

/** Format qty_base menjadi tampilan ramah pengguna sesuai satuan tampilan varian. */
export function formatQty(
  variant: Pick<VariantRow, "stock_type" | "display_unit" | "conversion_factor" | "allow_decimal"> &
    Partial<Pick<VariantRow, "units_per_display">>,
  qtyBase: number,
): string {
  const nf = (v: number, maxFrac: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxFrac }).format(v);
  if (variant.stock_type === "weight") {
    const unit = (WEIGHT_UNITS as readonly string[]).includes(variant.display_unit)
      ? variant.display_unit
      : "g";
    const factor = WEIGHT_TO_BASE_G[unit as keyof typeof WEIGHT_TO_BASE_G] ?? 1;
    const value = qtyBase / factor;
    return `${nf(value, 6)} ${unit}`;
  }
  const factor = Number(variant.units_per_display ?? variant.conversion_factor) || 1;
  const value = qtyBase / factor;
  return `${nf(value, variant.allow_decimal ? 2 : 0)} ${variant.display_unit || "pcs"}`;
}

export type ProductWithVariants = ProductRow & {
  variants: (VariantRow & { balance: number })[];
  photos: PhotoRow[];
  /** Stok induk gudang dalam satuan dasar (gram untuk timbangan, unit dasar untuk hitungan). */
  warehouse: number;
};

export type WarehouseProduct = Pick<ProductRow, "stock_kind" | "base_unit" | "buy_unit">;

/** Faktor konversi satuan beli gudang → satuan dasar. */
export function warehouseBuyFactor(product: Pick<ProductRow, "stock_kind" | "buy_factor">): number {
  const f = Number(product.buy_factor);
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/** Satuan tampilan stok gudang. */
export function warehouseUnit(product: WarehouseProduct): string {
  if (product.stock_kind === "weight") {
    const u = (product.buy_unit || "g").toLowerCase();
    return (WEIGHT_UNITS as readonly string[]).includes(u) ? u : "g";
  }
  return product.base_unit || "pcs";
}

/** Format stok gudang (qty dalam satuan dasar) menjadi teks satuan beli. */
export function formatWarehouseQty(product: WarehouseProduct, qtyBase: number): string {
  const unit = warehouseUnit(product);
  if (product.stock_kind === "weight") {
    const factor = WEIGHT_TO_BASE_G[unit as keyof typeof WEIGHT_TO_BASE_G] ?? 1;
    return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 }).format(qtyBase / factor)} ${unit}`;
  }
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(qtyBase)} ${unit}`;
}

/** Ukuran satu unit varian dalam satuan dasar gudang. */
export function warehouseUnitOptions(
  product: Pick<ProductRow, "stock_kind" | "base_unit" | "buy_unit">,
): string[] {
  if (product.stock_kind === "weight") return [...WEIGHT_UNITS];
  const base = product.base_unit || "pcs";
  const buy = product.buy_unit || base;
  return buy && buy !== base ? [base, buy] : [base];
}

/** Konversi jumlah + satuan pembelian gudang menjadi satuan dasar. */
export function toWarehouseBase(
  product: Pick<ProductRow, "stock_kind" | "base_unit" | "buy_unit" | "buy_factor">,
  qty: number,
  unit: string,
): number {
  if (product.stock_kind === "weight") {
    const factor = WEIGHT_TO_BASE_G[unit as keyof typeof WEIGHT_TO_BASE_G];
    if (!factor) throw new Error(VARIANT_MESSAGES.unit);
    return decimalMultiply(qty, factor);
  }
  const factor = unit === (product.buy_unit || "") ? warehouseBuyFactor(product) : 1;
  return Math.round(qty * factor);
}

export function variantUnitSize(
  variant: Pick<VariantRow, "stock_type" | "base_quantity_grams" | "units_per_display">,
): number {
  const size =
    variant.stock_type === "weight"
      ? Number(variant.base_quantity_grams ?? 0)
      : Number(variant.units_per_display ?? 0);
  return size > 0 ? size : 1;
}

/** Berapa unit varian yang bisa dijual dari stok gudang saat ini. */
export function variantAvailableUnits(
  product: Pick<ProductRow, "stock_kind">,
  variant: Pick<VariantRow, "stock_type" | "base_quantity_grams" | "units_per_display">,
  warehouseBase: number,
): number {
  const size = variantUnitSize(variant);
  const raw = warehouseBase / size;
  return product.stock_kind === "weight" ? Number(raw.toFixed(6)) : Math.floor(raw);
}

async function warehouseBalances(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = unwrap(
    await supabase
      .from("product_stock_balances")
      .select("product_id, qty_base")
      .in("product_id", productIds),
    "Gagal memuat stok gudang",
  );
  return new Map(rows.map((r) => [r.product_id, Number(r.qty_base)]));
}

export async function listCatalog(businessId: string): Promise<ProductWithVariants[]> {
  const products = unwrap(
    await supabase
      .from("products")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
    "Gagal memuat katalog",
  );
  if (products.length === 0) return [];
  const productIds = products.map((p) => p.id);
  const [variants, photos, warehouse] = await Promise.all([
    unwrap(
      await supabase
        .from("product_variants")
        .select("*")
        .in("product_id", productIds)
        .eq("is_active", true)
        .order("sort_order"),
      "Gagal memuat varian",
    ),
    unwrap(
      await supabase
        .from("product_photos")
        .select("*")
        .in("product_id", productIds)
        .order("sort_order"),
      "Gagal memuat foto",
    ),
    warehouseBalances(productIds),
  ]);
  return products.map((p) => {
    const pool = warehouse.get(p.id) ?? 0;
    return {
      ...p,
      warehouse: pool,
      photos: photos.filter((ph) => ph.product_id === p.id),
      // Saldo varian adalah turunan dari stok gudang bersama.
      variants: variants.filter((v) => v.product_id === p.id).map((v) => ({ ...v, balance: pool })),
    };
  });
}

export async function getProduct(productId: string): Promise<ProductWithVariants | null> {
  const product = unwrap(
    await supabase.from("products").select("*").eq("id", productId).maybeSingle(),
    "Produk tidak ditemukan",
  );
  if (!product) return null;
  const [variants, photos, warehouse] = await Promise.all([
    unwrap(
      await supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order"),
      "Gagal memuat varian",
    ),
    unwrap(
      await supabase
        .from("product_photos")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order"),
      "Gagal memuat foto",
    ),
    warehouseBalances([productId]),
  ]);
  const pool = warehouse.get(productId) ?? 0;
  return {
    ...product,
    photos,
    warehouse: pool,
    variants: variants.map((v) => ({ ...v, balance: pool })),
  };
}

export type ProductInput = {
  id?: string;
  business_id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  sku?: string;
  emoji?: string;
  discount_percent?: number;
  /** Jenis stok gudang: timbangan atau hitungan. */
  stock_kind?: StockType;
  /** Satuan dasar gudang: "g" untuk timbangan, pcs/botol untuk hitungan. */
  base_unit?: string;
  /** Satuan pembelian gudang (kg, ons, dus, karton, …). */
  buy_unit?: string;
  /** Berapa satuan dasar dalam 1 satuan beli (kg → 1000 g, dus → 24 botol). */
  buy_factor?: number;
  /** Harga beli per satuan beli. */
  purchase_price?: number;
};

export async function upsertProduct(input: ProductInput): Promise<ProductRow> {
  const warehouse = {
    ...(input.stock_kind !== undefined ? { stock_kind: input.stock_kind } : {}),
    ...(input.base_unit !== undefined ? { base_unit: input.base_unit } : {}),
    ...(input.buy_unit !== undefined ? { buy_unit: input.buy_unit } : {}),
    ...(input.buy_factor !== undefined ? { buy_factor: input.buy_factor } : {}),
    ...(input.purchase_price !== undefined ? { purchase_price: input.purchase_price } : {}),
  };
  if (input.id) {
    return unwrap(
      await supabase
        .from("products")
        .update({
          name: input.name,
          category: input.category,
          description: input.description,
          price: input.price,
          sku: input.sku ?? "",
          emoji: input.emoji ?? "📦",
          discount_percent: input.discount_percent ?? 0,
          ...warehouse,
        })
        .eq("id", input.id)
        .select("*")
        .single(),
      "Gagal menyimpan produk",
    );
  }
  return unwrap(
    await supabase
      .from("products")
      .insert({
        business_id: input.business_id,
        name: input.name,
        category: input.category,
        description: input.description,
        price: input.price,
        sku: input.sku ?? "",
        emoji: input.emoji ?? "📦",
        discount_percent: input.discount_percent ?? 0,
        ...warehouse,
      })
      .select("*")
      .single(),
    "Gagal membuat produk",
  );
}

/** Tambah atau koreksi stok langsung di gudang (satuan dasar). */
export async function adjustWarehouse(
  productId: string,
  qtyBase: number,
  type: MovementType,
  note: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("adjust_warehouse", {
    _product: productId,
    _qty_base: qtyBase,
    _type: type,
    _note: note,
  });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui stok gudang"));
  return Number(data);
}

export async function deleteProduct(productId: string) {
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw new Error(friendly(error.message, "Gagal menghapus produk"));
}

export type VariantInput = {
  id?: string | undefined;
  business_id: string;
  product_id: string;
  name: string;
  stock_type: StockType;
  base_unit?: string;
  display_unit: string;
  precision_scale?: number;
  conversion_factor?: number;
  allow_decimal?: boolean;
  price: number;
  sku?: string;
  sort_order?: number;
  /** weight: jumlah berat pada satuan tampilan (boleh desimal, mis. 0,01 g). */
  display_quantity?: string | number | null;
  /** count: isi per satuan tampilan (bilangan bulat > 0). */
  units_per_display?: string | number | null;
};

export async function upsertVariant(input: VariantInput): Promise<VariantRow> {
  const draft: VariantDraft = {
    name: input.name,
    stock_kind: input.stock_type,
    display_unit: input.display_unit,
    ...(input.base_unit !== undefined ? { base_unit: input.base_unit } : {}),
    display_quantity: input.display_quantity ?? 1,
    units_per_display: input.units_per_display ?? input.conversion_factor ?? 1,
    price: input.price,
    quantity_precision: input.precision_scale ?? null,
  };
  const check = validateVariantDraft(draft);
  if (!check.ok) throw new Error(check.message);
  const v = check.value;

  // Desimal dikirim sebagai string ternormalisasi agar presisi NUMERIC utuh.
  const payload = {
    business_id: input.business_id,
    product_id: input.product_id,
    name: v.name,
    stock_type: input.stock_type,
    base_unit: v.base_unit,
    display_unit: v.display_unit,
    precision_scale: toNumericString(v.quantity_precision),
    base_quantity_grams:
      v.base_quantity_grams === null ? null : toNumericString(v.base_quantity_grams),
    units_per_display: v.units_per_display,
    conversion_factor: toNumericString(v.units_per_display ?? 1),
    needs_review: false,
    allow_decimal: input.allow_decimal ?? input.stock_type === "weight",
    price: toNumericString(v.price, 2),
    sku: input.sku ?? "",
    sort_order: input.sort_order ?? 0,
  };
  if (input.id) {
    return unwrap(
      await supabase
        .from("product_variants")
        .update(payload as unknown as TablesUpdate<"product_variants">)
        .eq("id", input.id)
        .select("*")
        .single(),
      "Gagal menyimpan varian",
    );
  }
  const created = unwrap(
    await supabase
      .from("product_variants")
      .insert(payload as unknown as TablesInsert<"product_variants">)
      .select("*")
      .single(),
    "Gagal membuat varian",
  );
  const { error } = await supabase.from("inventory_balances").upsert(
    {
      variant_id: created.id,
      product_id: created.product_id,
      business_id: created.business_id,
      qty_base: 0,
    },
    { onConflict: "variant_id" },
  );
  if (error) throw new Error(friendly(error.message, "Gagal menyiapkan stok varian"));
  return created;
}

export async function deleteVariant(variantId: string) {
  const deactivate = async () => {
    const { error } = await supabase
      .from("product_variants")
      .update({ is_active: false })
      .eq("id", variantId);
    if (error) throw new Error(friendly(error.message, "Gagal menonaktifkan varian"));
  };

  // Varian yang pernah dipakai (riwayat stok, unit fisik non-draf, atau
  // terpakai di pesanan) tidak boleh dihapus permanen — cukup dinonaktifkan
  // supaya riwayat transaksi tetap utuh.
  const [movements, units, orderItems, chatItems] = await Promise.all([
    supabase.from("inventory_movements").select("id").eq("variant_id", variantId).limit(1),
    supabase
      .from("variant_stock_units")
      .select("id")
      .eq("variant_id", variantId)
      .neq("status", "draft")
      .limit(1),
    supabase.from("order_items").select("id").eq("variant_id", variantId).limit(1),
    supabase.from("chat_order_items").select("id").eq("variant_id", variantId).limit(1),
  ]);
  const used = [movements, units, orderItems, chatItems].some(
    (r) => (r.data?.length ?? 0) > 0 || Boolean(r.error),
  );
  if (used) {
    await deactivate();
    return;
  }

  const { error } = await supabase.from("product_variants").delete().eq("id", variantId);
  if (!error) return;
  // Fallback: bila database menolak hapus permanen (mis. unit sudah dialokasikan),
  // jangan tampilkan error mentah — nonaktifkan saja varian.
  await deactivate();
}

export async function adjustStock(
  variantId: string,
  qtyBase: number,
  type: MovementType,
  note: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("adjust_inventory", {
    _variant: variantId,
    _qty_base: qtyBase,
    _type: type,
    _note: note,
  });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui stok"));
  return Number(data);
}

export async function listMovements(variantId: string): Promise<MovementRow[]> {
  return unwrap(
    await supabase
      .from("inventory_movements")
      .select("*")
      .eq("variant_id", variantId)
      .order("created_at", { ascending: false })
      .limit(50),
    "Gagal memuat riwayat stok",
  );
}

export type PhotoInput = {
  file: Blob;
  fileName: string;
  variant_id?: string | null;
  caption?: string;
  location_url?: string;
  location_lat?: number | null;
  location_lng?: number | null;
  location_label?: string;
  location_accuracy?: number | null;
  group_label?: string;
  source_type?: "camera" | "gallery" | "preparation";
  location_mode?: "auto" | "manual" | "none";
  /** Foto milik satu unit fisik tertentu (bukan foto varian generik). */
  stock_unit_id?: string | null;
};

export async function addProductPhotos(
  businessId: string,
  productId: string,
  drafts: PhotoInput[],
) {
  const existing = unwrap(
    await supabase
      .from("product_photos")
      .select("sort_order")
      .eq("product_id", productId)
      .order("sort_order", { ascending: false })
      .limit(1),
    "Gagal memuat urutan foto",
  );
  let nextSort = (existing[0]?.sort_order ?? -1) + 1;
  const { data: auth } = await supabase.auth.getUser();
  // Semua objek yang sudah terunggah dicatat agar bisa dibersihkan bila ada satu langkah gagal.
  const uploaded: string[] = [];
  const rollback = async () => {
    for (const p of uploaded) await removeObject("product-photos", p).catch(() => undefined);
  };
  for (const d of drafts) {
    let up: { path: string };
    try {
      up = await uploadProductPhoto(businessId, d.file, d.fileName);
    } catch (err) {
      await rollback();
      throw err;
    }
    uploaded.push(up.path);
    const { error } = await supabase.from("product_photos").insert({
      business_id: businessId,
      product_id: productId,
      variant_id: d.variant_id ?? null,
      stock_unit_id: d.stock_unit_id ?? null,
      image_path: up.path,
      caption: d.caption ?? "",
      location_url: d.location_url ?? "",
      location_lat: d.location_lat ?? null,
      location_lng: d.location_lng ?? null,
      location_label: d.location_label ?? "",
      location_accuracy: d.location_accuracy ?? null,
      group_label: d.group_label ?? "",
      source_type: d.source_type ?? "gallery",
      location_mode:
        d.location_mode ??
        (d.location_lat != null && d.location_lng != null
          ? "auto"
          : (d.location_url ?? "") !== ""
            ? "manual"
            : "none"),
      created_by: auth.user?.id ?? null,
      sort_order: nextSort++,
    });
    if (error) {
      // Jangan tinggalkan file yatim di Storage saat insert baris gagal.
      await rollback();
      throw new Error(friendly(error.message, "Gagal menyimpan foto"));
    }
    // Baris tersimpan: objek ini tidak perlu di-rollback lagi.
    uploaded.pop();
  }
}

export async function updatePhotoLocation(
  photoId: string,
  patch: {
    location_url?: string;
    location_lat?: number | null;
    location_lng?: number | null;
    location_label?: string;
    location_mode?: "auto" | "manual" | "none";
    caption?: string;
  },
) {
  // Update hanya menyentuh baris foto ini; lokasi foto lain tidak ikut berubah.
  const { error } = await supabase.from("product_photos").update(patch).eq("id", photoId);
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui lokasi foto"));
}

export async function deletePhoto(photoId: string) {
  const row = unwrap(
    await supabase.from("product_photos").select("image_path").eq("id", photoId).maybeSingle(),
    "Foto tidak ditemukan",
  );
  if (row?.image_path) await removeObject("product-photos", row.image_path);
  const { error } = await supabase.from("product_photos").delete().eq("id", photoId);
  if (error) throw new Error(friendly(error.message, "Gagal menghapus foto"));
}

/** Ubah hanya sort_order berdasarkan urutan array id; metadata lokasi tiap foto tidak pernah tertukar. */
export async function reorderPhotos(orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("product_photos")
      .update({ sort_order: i })
      .eq("id", orderedIds[i]!);
    if (error) throw new Error(friendly(error.message, "Gagal mengurutkan foto"));
  }
}
