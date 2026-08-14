/**
 * Kartu produk terstruktur untuk chat.
 *
 * Produk yang dikirim ke pelanggan TIDAK dikirim sebagai pesan teruskan biasa.
 * Kita menyimpan snapshot terstruktur (product_id, variant_id, harga, satuan,
 * dan setiap foto beserta lokasinya) di `messages.payload`, sehingga penerima
 * melihat kartu yang bisa dibaca aplikasi, bukan sekadar teks.
 */
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { friendly } from "@/lib/api/db";
import { sendMessage } from "@/lib/api/chat";

export type ProductCardPhoto = {
  id: string;
  image_path: string;
  caption: string;
  location_url: string;
  location_label: string;
  location_lat: number | null;
  location_lng: number | null;
};

/**
 * Skema tunggal untuk memvalidasi jsonb dari RPC `build_product_card`.
 * Ini satu-satunya batas cast di modul ini; sisanya sudah bertipe.
 */
const photoSchema = z.object({
  id: z.string(),
  image_path: z.string(),
  caption: z.string().default(""),
  location_url: z.string().default(""),
  location_label: z.string().default(""),
  location_lat: z.number().nullable().default(null),
  location_lng: z.number().nullable().default(null),
});

const cardSchema = z.object({
  type: z.literal("product_card"),
  productId: z.string(),
  variantId: z.string(),
  businessId: z.string(),
  productName: z.string(),
  variantName: z.string(),
  price: z.coerce.number(),
  unit: z.string(),
  description: z.string().default(""),
  perUnitQty: z.coerce.number(),
  perUnitQtyBase: z.coerce.number(),
  perUnitUnit: z.string(),
  perUnitEditable: z.boolean().default(false),
  availableQtyBase: z.coerce.number().default(0),
  availableQtyDisplay: z.coerce.number().default(0),
  availableUnitCount: z.coerce.number().default(0),
  stockLabel: z.string().default(""),
  photos: z.array(photoSchema).default([]),
});

export type ProductCardPayload = z.infer<typeof cardSchema>;

/**
 * Snapshot kartu produk selalu disusun server (`build_product_card`):
 * varian WAJIB valid + aktif, isi per unit persis definisi varian, dan hanya
 * media yang boleh dipublikasikan (foto varian publik + foto unit `available`).
 */
export async function buildProductCard(
  productId: string,
  variantId: string | null,
): Promise<ProductCardPayload> {
  if (!variantId) throw new Error("Pilih varian produk terlebih dahulu");
  const { data, error } = await supabase.rpc("build_product_card", {
    _product: productId,
    _variant: variantId,
  });
  if (error) throw new Error(friendly(error.message, "Gagal menyusun kartu produk"));
  return cardSchema.parse(data);
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
