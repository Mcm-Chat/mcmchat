/**
 * Kartu produk terstruktur untuk chat.
 *
 * Produk yang dikirim ke pelanggan TIDAK dikirim sebagai pesan teruskan biasa.
 * Kita menyimpan snapshot terstruktur (product_id, variant_id, harga, satuan,
 * dan setiap foto beserta lokasinya) di `messages.payload`, sehingga penerima
 * melihat kartu yang bisa dibaca aplikasi, bukan sekadar teks.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "@/lib/api/db";
import { sendMessage } from "@/lib/api/chat";
import { formatQty, type PhotoRow, type VariantRow } from "@/lib/api/catalog";

export type ProductCardPhoto = {
  id: string;
  image_path: string;
  caption: string;
  location_url: string;
  location_label: string;
  location_lat: number | null;
  location_lng: number | null;
};

export type ProductCardPayload = {
  type: "product_card";
  productId: string;
  variantId: string | null;
  businessId: string;
  productName: string;
  variantName: string;
  price: number;
  unit: string;
  stockLabel: string;
  description: string;
  photos: ProductCardPhoto[];
};

const photoOf = (p: PhotoRow): ProductCardPhoto => ({
  id: p.id,
  image_path: p.image_path,
  caption: p.caption ?? "",
  location_url: p.location_url ?? "",
  location_label: p.location_label ?? "",
  location_lat: p.location_lat,
  location_lng: p.location_lng,
});

/** Susun snapshot kartu produk dari database (harga & stok saat dikirim). */
export async function buildProductCard(
  productId: string,
  variantId: string | null,
): Promise<ProductCardPayload> {
  const product = unwrap(
    await supabase.from("products").select("*").eq("id", productId).single(),
    "Produk tidak ditemukan",
  );
  const variants = unwrap(
    await supabase.from("product_variants").select("*").eq("product_id", productId),
    "Gagal memuat varian",
  );
  const variant: VariantRow | null =
    variants.find((v) => v.id === variantId) ?? variants[0] ?? null;

  let stockLabel = "";
  if (variant) {
    const { data: bal } = await supabase
      .from("inventory_balances")
      .select("qty_base")
      .eq("variant_id", variant.id)
      .maybeSingle();
    stockLabel = formatQty(variant, Number(bal?.qty_base ?? 0));
  }

  const photos = unwrap(
    await supabase
      .from("product_photos")
      .select("*")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true }),
    "Gagal memuat foto produk",
  );
  const scoped = variant ? photos.filter((p) => !p.variant_id || p.variant_id === variant.id) : photos;

  return {
    type: "product_card",
    productId,
    variantId: variant?.id ?? null,
    businessId: product.business_id,
    productName: product.name,
    variantName: variant?.name ?? "",
    price: Number(variant?.price ?? product.price ?? 0),
    unit: variant?.display_unit ?? "",
    stockLabel,
    description: product.description ?? "",
    photos: scoped.slice(0, 12).map(photoOf),
  };
}

/** Kirim kartu produk terstruktur ke sebuah percakapan. */
export async function sendProductCard(input: {
  conversationId: string;
  senderId: string;
  productId: string;
  variantId: string | null;
  note?: string;
}) {
  try {
    const payload = await buildProductCard(input.productId, input.variantId);
    const title = payload.variantName
      ? `${payload.productName} — ${payload.variantName}`
      : payload.productName;
    return await sendMessage({
      conversationId: input.conversationId,
      senderId: input.senderId,
      kind: "product_card",
      body: input.note?.trim() ? input.note.trim() : title,
      payload: { ...payload, note: input.note?.trim() ?? "" } as never,
    });
  } catch (err) {
    throw new Error(
      friendly(err instanceof Error ? err.message : "", "Gagal mengirim kartu produk"),
    );
  }
}
