import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { createLedger } from "./ledger";
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

export type SaleItemInput = {
  productId: string | null;
  name: string;
  price: number;
  qty: number;
  discount: number;
  photoIds: string[];
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

/**
 * Catat penjualan sekali jalan: order + item + sales_record, lalu (bila perlu)
 * catatan piutang dan kartu rincian di chat. Idempotency key mencegah dobel
 * saat tombol ditekan dua kali atau koneksi terputus.
 */
export async function createSale(input: CreateSaleInput): Promise<SalesRecordRow> {
  const errors = validateSale(input);
  if (errors.length > 0) throw new Error(errors[0]);

  const existing = unwrap(
    await supabase.from("sales_records").select("*").eq("business_id", input.businessId).eq("idempotency_key", input.idempotencyKey).limit(1),
    "Gagal memeriksa penjualan",
  );
  if (existing[0]) return existing[0];

  const { subtotal, total } = computeTotals(input.items, input.discount, input.extraFee);
  const paid = input.paymentMethod === "credit" ? Math.min(input.paidAmount, total) : Math.min(input.paidAmount, total);
  const number = `INV-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const order = unwrap(
    await supabase
      .from("orders")
      .insert({
        business_id: input.businessId,
        number,
        buyer_user_id: input.customerUserId,
        note: input.note,
        discount: input.discount,
        shipping: input.extraFee,
        total,
        status: "new",
      })
      .select("*")
      .single(),
    "Gagal menyimpan pesanan",
  );

  const { error: itemErr } = await supabase.from("order_items").insert(
    input.items.map((i) => ({
      order_id: order.id,
      business_id: input.businessId,
      product_id: i.productId,
      name: i.name,
      price: i.price,
      qty: i.qty,
      discount: i.discount,
      photo_ids: i.photoIds,
    })),
  );
  if (itemErr) throw new Error(friendly(itemErr.message, "Gagal menyimpan item penjualan"));

  const record = unwrap(
    await supabase
      .from("sales_records")
      .insert({
        business_id: input.businessId,
        seller_id: input.sellerId,
        order_id: order.id,
        idempotency_key: input.idempotencyKey,
        customer_user_id: input.customerUserId,
        conversation_id: input.conversationId,
        subtotal,
        discount: input.discount,
        extra_fee: input.extraFee,
        total,
        paid_amount: paid,
        payment_method: input.paymentMethod,
        due_date: input.dueDate,
        note: input.note,
        payload: {
          number,
          customerName: input.customerName,
          items: input.items,
        } as never,
      })
      .select("*")
      .single(),
    "Gagal menyimpan penjualan",
  );

  const outstanding = total - paid;
  if (outstanding > 0) {
    await createLedger({
      ownerId: input.sellerId,
      counterpartUserId: input.customerUserId,
      counterpartName: input.customerName || "Pelanggan",
      type: "receivable",
      amount: total,
      paidAmount: paid,
      dueDate: input.dueDate,
      note: `Penjualan ${number}`,
      salesRecordId: record.id,
      conversationId: input.conversationId,
    });
  }

  if (input.conversationId) {
    const message = await sendMessage({
      conversationId: input.conversationId,
      senderId: input.sellerId,
      kind: "sales_card",
      body: `Rincian penjualan ${number}`,
      payload: {
        number,
        total,
        paid,
        outstanding,
        paymentMethod: input.paymentMethod,
        dueDate: input.dueDate,
        items: input.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, discount: i.discount })),
      },
    });
    await supabase.from("sales_records").update({ message_id: message.id }).eq("id", record.id);
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
