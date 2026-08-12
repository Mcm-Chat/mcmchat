import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { notifySale } from "@/lib/push/push.functions";
import { sendMessage } from "./chat";
import type { Tables } from "@/integrations/supabase/types";

export type SalesRecordRow = Tables<"sales_records">;
export type OrderRow = Tables<"orders">;
export type OrderItemRow = Tables<"order_items">;
export type PaymentMethod = SalesRecordRow["payment_method"];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  dp: "DP / uang muka",
  credit: "Kredit / tempo",
};

export type SaleItemPhotoInput = {
  id: string;
  location_url?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_label?: string | null;
};

export type SaleItemInput = {
  productId: string | null;
  variantId: string | null;
  name: string;
  variantName: string;
  unit: string;
  price: number;
  qty: number;
  qtyBase: number;
  discount: number;
  photoIds: string[];
  photos?: SaleItemPhotoInput[];
};

export type CreateSaleInput = {
  businessId: string;
  sellerId: string;
  idempotencyKey: string;
  items: SaleItemInput[];
  discount: number;
  extraFee: number;
  paymentMethod: PaymentMethod;
  paidAmount: number;
  dueDate: string | null;
  note: string;
  customerName: string;
  customerUserId: string | null;
  conversationId: string | null;
};

export function computeTotals(items: SaleItemInput[], discount: number, extraFee: number) {
  const subtotal = items.reduce((s, i) => s + Math.max(0, i.price - i.discount) * i.qty, 0);
  const total = Math.max(0, subtotal - discount + extraFee);
  return { subtotal, total };
}

export function validateSale(input: Pick<CreateSaleInput, "items" | "discount" | "extraFee" | "paymentMethod" | "paidAmount" | "dueDate">) {
  const errors: string[] = [];
  if (input.items.length === 0) errors.push("Tambahkan minimal satu item.");
  if (input.items.some((i) => i.qty <= 0)) errors.push("Jumlah item harus lebih dari nol.");
  if (input.items.some((i) => i.price < 0 || i.discount < 0)) errors.push("Harga dan diskon tidak boleh negatif.");
  const { total } = computeTotals(input.items, input.discount, input.extraFee);
  if (total <= 0) errors.push("Total penjualan harus lebih dari nol.");
  if (input.paidAmount < 0 || input.paidAmount > total) errors.push("Jumlah dibayar tidak valid.");
  if (input.paymentMethod === "dp" && input.paidAmount <= 0) errors.push("DP harus lebih dari nol.");
  if ((input.paymentMethod === "dp" || input.paymentMethod === "credit") && !input.dueDate)
    errors.push("Tanggal jatuh tempo wajib untuk DP atau kredit.");
  return errors;
}

type SaleTxResult = {
  sale_id: string;
  order_id: string;
  ledger_id: string | null;
  total: number;
  paid: number;
  number: string;
  already: boolean;
};

/**
 * Catat penjualan sekali jalan lewat RPC transaksional `create_sale_tx`:
 * order + item + sales_record + (bila perlu) piutang, semuanya atomik.
 * Idempotency key mencegah dobel saat tombol ditekan dua kali atau koneksi terputus;
 * jika key sama sudah pernah dipakai, RPC mengembalikan catatan yang sama (already: true)
 * dan kita tidak mengirim kartu chat kedua kalinya.
 */
export async function createSale(input: CreateSaleInput): Promise<SalesRecordRow> {
  const errors = validateSale(input);
  if (errors.length > 0) throw new Error(errors[0]);

  const payload = {
    business_id: input.businessId,
    idempotency_key: input.idempotencyKey,
    conversation_id: input.conversationId,
    customer_user_id: input.customerUserId,
    customer_name: input.customerName || "Pelanggan",
    note: input.note,
    discount: input.discount,
    extra_fee: input.extraFee,
    payment_method: input.paymentMethod,
    paid_amount: input.paidAmount,
    due_date: input.dueDate,
    items: input.items.map((i) => ({
      product_id: i.productId,
      variant_id: i.variantId,
      name: i.name,
      variant_name: i.variantName,
      qty: i.qty,
      qty_base: i.qtyBase,
      unit: i.unit,
      price: i.price,
      discount: i.discount,
      photo_ids: i.photoIds,
    })),
  };

  const { data, error } = await supabase.rpc("create_sale_tx", { _payload: payload as never });
  if (error) throw new Error(friendly(error.message, "Gagal mencatat penjualan"));
  const result = data as unknown as SaleTxResult;

  const record = unwrap(
    await supabase.from("sales_records").select("*").eq("id", result.sale_id).single(),
    "Gagal memuat penjualan",
  );

  if (!result.already && input.conversationId) {
    const outstanding = Math.max(0, result.total - result.paid);
    const message = await sendMessage({
      conversationId: input.conversationId,
      senderId: input.sellerId,
      kind: "sales_card",
      body: `Rincian penjualan ${result.number}`,
      payload: {
        number: result.number,
        total: result.total,
        paid: result.paid,
        outstanding,
        paymentMethod: input.paymentMethod,
        dueDate: input.dueDate,
        note: input.note,
        items: input.items.map((i) => ({
          name: i.name,
          variantName: i.variantName,
          unit: i.unit,
          qty: i.qty,
          price: i.price,
          discount: i.discount,
          photos: i.photos ?? [],
        })),
      },
    });
    await supabase.from("sales_records").update({ message_id: message.id }).eq("id", record.id);
    // Target notifikasi dibaca server dari record penjualan yang sudah tersimpan.
    void notifySale({ data: { saleId: record.id } }).catch(() => undefined);
    return { ...record, message_id: message.id };
  }

  return record;
}

export async function listSales(businessId: string) {
  return unwrap(
    await supabase.from("sales_records").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
    "Gagal memuat penjualan",
  );
}

export async function listOrders(businessId: string) {
  return unwrap(
    await supabase.from("orders").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
    "Gagal memuat pesanan",
  );
}

export async function updateOrderStatus(orderId: string, status: OrderRow["status"]) {
  const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui pesanan"));
}
