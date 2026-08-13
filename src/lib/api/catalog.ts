import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { removeObject, uploadProductPhoto } from "./storage";
import type { Tables } from "@/integrations/supabase/types";
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
};

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
  const [variants, photos, balances] = await Promise.all([
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
    unwrap(
      await supabase.from("inventory_balances").select("*").in("product_id", productIds),
      "Gagal memuat stok",
    ),
  ]);
  return products.map((p) => ({
    ...p,
    photos: photos.filter((ph) => ph.product_id === p.id),
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => ({ ...v, balance: balances.find((b) => b.variant_id === v.id)?.qty_base ?? 0 })),
  }));
}

export async function getProduct(productId: string): Promise<ProductWithVariants | null> {
  const product = unwrap(
    await supabase.from("products").select("*").eq("id", productId).maybeSingle(),
    "Produk tidak ditemukan",
  );
  if (!product) return null;
  const [variants, photos, balances] = await Promise.all([
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
    unwrap(
      await supabase.from("inventory_balances").select("*").eq("product_id", productId),
      "Gagal memuat stok",
    ),
  ]);
  return {
    ...product,
    photos,
    variants: variants.map((v) => ({
      ...v,
      balance: balances.find((b) => b.variant_id === v.id)?.qty_base ?? 0,
    })),
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
};

export async function upsertProduct(input: ProductInput): Promise<ProductRow> {
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
      })
      .select("*")
      .single(),
    "Gagal membuat produk",
  );
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
};

export async function upsertVariant(input: VariantInput): Promise<VariantRow> {
  const payload = {
    business_id: input.business_id,
    product_id: input.product_id,
    name: input.name,
    stock_type: input.stock_type,
    base_unit: input.stock_type === "weight" ? "g" : (input.base_unit ?? input.display_unit),
    display_unit: input.display_unit,
    precision_scale: input.precision_scale ?? (input.stock_type === "weight" ? 0.01 : 1),
    conversion_factor: input.stock_type === "count" ? (input.conversion_factor ?? 1) : 1,
    allow_decimal: input.allow_decimal ?? input.stock_type === "weight",
    price: input.price,
    sku: input.sku ?? "",
    sort_order: input.sort_order ?? 0,
  };
  if (input.id) {
    return unwrap(
      await supabase
        .from("product_variants")
        .update(payload)
        .eq("id", input.id)
        .select("*")
        .single(),
      "Gagal menyimpan varian",
    );
  }
  const created = unwrap(
    await supabase.from("product_variants").insert(payload).select("*").single(),
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
  const movements = unwrap(
    await supabase.from("inventory_movements").select("id").eq("variant_id", variantId).limit(1),
    "Gagal memeriksa riwayat varian",
  );
  if (movements.length > 0) {
    const { error } = await supabase
      .from("product_variants")
      .update({ is_active: false })
      .eq("id", variantId);
    if (error) throw new Error(friendly(error.message, "Gagal menonaktifkan varian"));
    return;
  }
  const { error } = await supabase.from("product_variants").delete().eq("id", variantId);
  if (error) throw new Error(friendly(error.message, "Gagal menghapus varian"));
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
  for (const d of drafts) {
    const up = await uploadProductPhoto(businessId, d.file, d.fileName);
    const { error } = await supabase.from("product_photos").insert({
      business_id: businessId,
      product_id: productId,
      variant_id: d.variant_id ?? null,
      image_path: up.path,
      caption: d.caption ?? "",
      location_url: d.location_url ?? "",
      location_lat: d.location_lat ?? null,
      location_lng: d.location_lng ?? null,
      location_label: d.location_label ?? "",
      location_accuracy: d.location_accuracy ?? null,
      group_label: d.group_label ?? "",
      sort_order: nextSort++,
    });
    if (error) throw new Error(friendly(error.message, "Gagal menyimpan foto"));
  }
}

export async function updatePhotoLocation(
  photoId: string,
  patch: {
    location_url?: string;
    location_lat?: number | null;
    location_lng?: number | null;
    location_label?: string;
  },
) {
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
