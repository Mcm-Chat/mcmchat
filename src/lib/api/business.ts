import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { removeObject, uploadProductPhoto } from "./storage";
import type { Tables } from "@/integrations/supabase/types";

export type BusinessRow = Tables<"businesses">;
export type BusinessMemberRow = Tables<"business_members">;
export type ProductRow = Tables<"products">;
export type ProductPhotoRow = Tables<"product_photos">;
export type ProductWithPhotos = ProductRow & { photos: ProductPhotoRow[] };

export const ROLE_LABEL: Record<BusinessMemberRow["role"], string> = {
  owner: "Pemilik",
  admin: "Admin",
  agent: "Agen",
  cashier: "Kasir",
  viewer: "Pengamat",
};

export const canManage = (role?: BusinessMemberRow["role"] | null) => role === "owner" || role === "admin";
export const canSell = (role?: BusinessMemberRow["role"] | null) =>
  role === "owner" || role === "admin" || role === "agent" || role === "cashier";

/**
 * Kolom `business_members` yang boleh dibaca klien. `staff_pin` sengaja
 * dikecualikan: PIN pegawai hanya boleh keluar lewat RPC
 * `business_staff_directory` untuk pemilik/admin.
 */
export const MEMBER_SAFE_COLUMNS =
  "id, business_id, user_id, role, staff_display_name, staff_pin_confirmed_at, created_at, updated_at";

export type SafeBusinessMemberRow = Omit<BusinessMemberRow, "staff_pin">;

export async function myBusiness(userId: string): Promise<{ business: BusinessRow; role: BusinessMemberRow["role"] } | null> {
  const memberships = unwrap(
    await supabase.from("business_members").select(MEMBER_SAFE_COLUMNS).eq("user_id", userId).limit(1),
    "Gagal memuat bisnis",
  );
  const m = memberships[0];
  if (!m) return null;
  const business = unwrap(await supabase.from("businesses").select("*").eq("id", m.business_id).maybeSingle(), "Bisnis tidak ditemukan");
  return { business, role: m.role };
}

export async function createBusiness(userId: string, name: string, category: string): Promise<BusinessRow> {
  return unwrap(
    await supabase.from("businesses").insert({ owner_id: userId, name, category }).select("*").single(),
    "Gagal membuat bisnis",
  );
}

export async function listProducts(businessId: string): Promise<ProductWithPhotos[]> {
  const products = unwrap(
    await supabase.from("products").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
    "Gagal memuat produk",
  );
  if (products.length === 0) return [];
  const photos = unwrap(
    await supabase
      .from("product_photos")
      .select("*")
      .in("product_id", products.map((p) => p.id))
      .order("sort_order", { ascending: true }),
    "Gagal memuat foto produk",
  );
  return products.map((p) => ({ ...p, photos: photos.filter((ph) => ph.product_id === p.id) }));
}

export function finalPrice(p: Pick<ProductRow, "price" | "discount_percent">) {
  return Math.round(Number(p.price) * (1 - Number(p.discount_percent) / 100));
}

export function matchesQuery(p: ProductWithPhotos, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [p.name, p.category, p.sku, p.description, ...p.photos.flatMap((ph) => [ph.caption, ph.location_url, ph.location_label])]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(needle));
}

export type PhotoDraft = {
  id?: string;
  file?: Blob;
  fileName?: string;
  previewUrl: string;
  image_path?: string;
  caption: string;
  location_url: string;
  location_lat: number | null;
  location_lng: number | null;
  location_label: string;
};

/** Simpan foto produk: setiap foto membawa lokasinya sendiri dan urutan dinormalisasi ulang. */
export async function saveProductPhotos(businessId: string, productId: string, drafts: PhotoDraft[], removedIds: string[]) {
  if (removedIds.length > 0) {
    const existing = unwrap(await supabase.from("product_photos").select("id, image_path").in("id", removedIds), "Gagal menghapus foto");
    for (const row of existing) if (row.image_path) await removeObject("product-photos", row.image_path);
    await supabase.from("product_photos").delete().in("id", removedIds);
  }
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i]!;
    const base = {
      caption: d.caption,
      location_url: d.location_url,
      location_lat: d.location_lat,
      location_lng: d.location_lng,
      location_label: d.location_label,
      sort_order: i,
    };
    if (d.id) {
      const { error } = await supabase.from("product_photos").update(base).eq("id", d.id);
      if (error) throw new Error(friendly(error.message, "Gagal menyimpan foto"));
    } else {
      if (!d.file) continue;
      const up = await uploadProductPhoto(businessId, d.file, d.fileName ?? "foto.jpg");
      const { error } = await supabase
        .from("product_photos")
        .insert({ ...base, product_id: productId, business_id: businessId, image_path: up.path });
      if (error) throw new Error(friendly(error.message, "Gagal menyimpan foto"));
    }
  }
}

export async function listQuickReplies(businessId: string) {
  return unwrap(await supabase.from("quick_replies").select("*").eq("business_id", businessId).order("shortcut"), "Gagal memuat balasan cepat");
}
