/**
 * Pesanan lewat chat: katalog → permintaan pembeli → konfirmasi penjual →
 * persetujuan pembeli → lanjut ke pegawai → siap → pembayaran → pengiriman.
 *
 * Semua transisi dijalankan oleh RPC SECURITY DEFINER yang mengunci baris,
 * memeriksa ulang otorisasi setelah lock, dan bersifat idempoten sehingga
 * dobel-tap tidak pernah membuat pesanan/reservasi/penjualan ganda.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { sendMessage } from "./chat";
import type { Tables } from "@/integrations/supabase/types";

export type ChatOrderRow = Tables<"chat_orders">;
export type ChatOrderItemRow = Tables<"chat_order_items">;
export type ChatOrderSlotRow = Tables<"chat_order_unit_slots">;
export type ChatOrderStatus = ChatOrderRow["status"];
export type SlotMode = ChatOrderSlotRow["mode"];

export type ChatOrderFull = ChatOrderRow & {
  items: ChatOrderItemRow[];
  slots: ChatOrderSlotRow[];
};

export const ORDER_STATUS_LABEL: Record<ChatOrderStatus, string> = {
  buyer_requested: "Menunggu konfirmasi toko",
  seller_confirmed: "Menunggu persetujuan pembeli",
  changes_requested: "Pembeli minta perubahan",
  buyer_approved: "Pembeli menyetujui",
  dispatched_to_preparation: "Dikirim ke pegawai",
  preparing: "Sedang disiapkan",
  ready_for_payment: "Siap dikirim",
  delivered: "Terkirim",
  cancelled: "Dibatalkan",
};

export const ORDER_STEPS: ChatOrderStatus[] = [
  "buyer_requested",
  "seller_confirmed",
  "buyer_approved",
  "dispatched_to_preparation",
  "ready_for_payment",
  "delivered",
];

/** Total dihitung ulang dari snapshot item; klien tidak pernah menjadi sumber kebenaran. */
export function orderTotals(order: ChatOrderFull) {
  const subtotal = order.items.reduce(
    (s, i) => s + Math.max(0, Number(i.price) - Number(i.discount)) * i.unit_count,
    0,
  );
  const total = Math.max(0, subtotal - Number(order.discount) + Number(order.extra_fee));
  return { subtotal, total };
}

/** Jumlah unit fisik yang diminta pada seluruh pesanan. */
export const totalUnits = (items: ChatOrderItemRow[]) =>
  items.reduce((s, i) => s + i.unit_count, 0);

export async function getChatOrder(orderId: string): Promise<ChatOrderFull> {
  const order = unwrap(
    await supabase.from("chat_orders").select("*").eq("id", orderId).single(),
    "Pesanan tidak ditemukan",
  );
  const [items, slots] = await Promise.all([
    unwrap(
      await supabase
        .from("chat_order_items")
        .select("*")
        .eq("chat_order_id", orderId)
        .order("sort_order"),
      "Gagal memuat item pesanan",
    ),
    unwrap(
      await supabase
        .from("chat_order_unit_slots")
        .select("*")
        .eq("chat_order_id", orderId)
        .order("slot_no"),
      "Gagal memuat slot unit",
    ),
  ]);
  return { ...order, items, slots };
}

export async function listChatOrders(conversationId: string): Promise<ChatOrderRow[]> {
  return unwrap(
    await supabase
      .from("chat_orders")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }),
    "Gagal memuat pesanan",
  );
}

export type NewOrderItem = {
  variantId: string;
  unitCount: number;
  perUnitQty: number;
  perUnitUnit: string;
  price?: number;
  discount?: number;
};

export async function createChatOrder(input: {
  businessId: string;
  conversationId: string;
  items: NewOrderItem[];
  note?: string;
  customerName?: string;
  buyerUserId?: string | null;
  senderUserId: string;
  idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_chat_order", {
    _payload: {
      business_id: input.businessId,
      conversation_id: input.conversationId,
      note: input.note ?? "",
      customer_name: input.customerName ?? "",
      buyer_user_id: input.buyerUserId ?? null,
      idempotency_key: input.idempotencyKey,
      items: input.items.map((i) => ({
        variant_id: i.variantId,
        unit_count: i.unitCount,
        per_unit_qty: i.perUnitQty,
        per_unit_unit: i.perUnitUnit,
        ...(i.price !== undefined ? { price: i.price } : {}),
        ...(i.discount !== undefined ? { discount: i.discount } : {}),
      })),
    } as never,
  });
  if (error) throw new Error(friendly(error.message, "Gagal mengajukan pesanan"));
  const orderId = data as unknown as string;
  await ensureOrderMessage({
    conversationId: input.conversationId,
    senderId: input.senderUserId,
    orderId,
  });
  return orderId;
}

/**
 * Kartu pesanan di chat adalah satu pesan saja; statusnya dibaca langsung dari
 * `chat_orders` sehingga tidak pernah ada dua kartu yang saling bertentangan.
 * client_id membuat pengiriman kartu idempoten terhadap dobel-tap.
 */
async function ensureOrderMessage(input: {
  conversationId: string;
  senderId: string;
  orderId: string;
}) {
  const existing = unwrap(
    await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", input.conversationId)
      .eq("client_id", `chat-order:${input.orderId}`)
      .limit(1),
    "Gagal memeriksa kartu pesanan",
  );
  if (existing.length > 0) return;
  await sendMessage({
    conversationId: input.conversationId,
    senderId: input.senderId,
    kind: "order",
    body: "Permintaan pesanan",
    clientId: `chat-order:${input.orderId}`,
    payload: { chatOrderId: input.orderId },
  });
}

export async function confirmChatOrder(input: {
  orderId: string;
  items: {
    id: string;
    unit_count?: number;
    price?: number;
    discount?: number;
    availability_note?: string;
  }[];
  note?: string;
  discount?: number;
  extraFee?: number;
}): Promise<ChatOrderRow> {
  const { data, error } = await supabase.rpc("confirm_chat_order", {
    _order: input.orderId,
    _items: input.items as never,
    _note: input.note ?? "",
    _discount: input.discount ?? 0,
    _extra: input.extraFee ?? 0,
  });
  if (error) throw new Error(friendly(error.message, "Gagal mengonfirmasi pesanan"));
  return data as unknown as ChatOrderRow;
}

export async function approveChatOrder(orderId: string): Promise<ChatOrderRow> {
  const { data, error } = await supabase.rpc("approve_chat_order", { _order: orderId });
  if (error) throw new Error(friendly(error.message, "Gagal menyetujui pesanan"));
  return data as unknown as ChatOrderRow;
}

export async function requestChatOrderChanges(orderId: string, note: string) {
  const { data, error } = await supabase.rpc("request_chat_order_changes", {
    _order: orderId,
    _note: note,
  });
  if (error) throw new Error(friendly(error.message, "Gagal meminta perubahan"));
  return data as unknown as ChatOrderRow;
}

export async function cancelChatOrder(orderId: string, reason = "", voidReady = false) {
  const { data, error } = await supabase.rpc("cancel_chat_order", {
    _order: orderId,
    _reason: reason,
    _void_ready: voidReady,
  });
  if (error) throw new Error(friendly(error.message, "Gagal membatalkan pesanan"));
  return data as unknown as ChatOrderRow;
}

export type SlotPlan = {
  itemId: string;
  slotNo: number;
  mode: SlotMode;
  stockUnitId?: string | null;
  notes?: string;
  requirePhoto?: boolean;
  requireLocation?: boolean;
};

/**
 * "Lanjut ke pegawai": satu transaksi atomik membuat satu perintah penyiapan
 * berisi satu kartu per unit fisik, dan mereservasi unit siap yang dipilih.
 */
export async function dispatchChatOrder(input: {
  orderId: string;
  assignedUserId: string;
  slots: SlotPlan[];
  expiresHours?: number;
}): Promise<{ id: string; code: string; token?: string; already: boolean }> {
  const { data, error } = await supabase.rpc("dispatch_chat_order", {
    _order: input.orderId,
    _assigned: input.assignedUserId,
    _slots: input.slots.map((s) => ({
      item_id: s.itemId,
      slot_no: s.slotNo,
      mode: s.mode,
      stock_unit_id: s.stockUnitId ?? null,
      notes: s.notes ?? "",
      require_photo: s.requirePhoto ?? true,
      require_location: s.requireLocation ?? true,
    })) as never,
    _expires_hours: input.expiresHours ?? 168,
  });
  if (error) throw new Error(friendly(error.message, "Gagal melanjutkan ke pegawai"));
  return data as unknown as { id: string; code: string; token?: string; already: boolean };
}

export type PaymentInput = {
  paymentMethod: "cash" | "transfer" | "dp" | "credit";
  paidAmount: number;
  dueDate: string | null;
};

/** Validasi klien; server tetap memvalidasi ulang dengan aturan yang sama/lebih ketat. */
export function validatePayment(p: PaymentInput, total: number): string[] {
  const errors: string[] = [];
  if (total <= 0) errors.push("Total pesanan harus lebih dari nol.");
  if (p.paidAmount < 0 || p.paidAmount > total) errors.push("Jumlah dibayar tidak valid.");
  if (p.paymentMethod === "dp" && p.paidAmount <= 0) errors.push("DP harus lebih dari nol.");
  if (p.paymentMethod === "dp" && p.paidAmount >= total)
    errors.push("DP lunas: gunakan metode tunai atau transfer.");
  if (p.paymentMethod === "credit" && p.paidAmount !== 0)
    errors.push("Kredit tidak menerima pembayaran awal: gunakan DP.");
  if ((p.paymentMethod === "dp" || p.paymentMethod === "credit") && !p.dueDate)
    errors.push("Tanggal jatuh tempo wajib untuk DP atau kredit.");
  if (p.dueDate) {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (p.dueDate < iso) errors.push("Tanggal jatuh tempo tidak boleh sebelum hari ini.");
  }
  return errors;
}

export async function finalizeChatOrderDelivery(input: {
  orderId: string;
  payment: PaymentInput;
  idempotencyKey?: string;
}) {
  const { data, error } = await supabase.rpc("finalize_chat_order_delivery", {
    _order: input.orderId,
    _payment: {
      payment_method: input.payment.paymentMethod,
      paid_amount: input.payment.paidAmount,
      due_date: input.payment.dueDate,
      idempotency_key: input.idempotencyKey ?? `chatorder:${input.orderId}`,
    } as never,
  });
  if (error) throw new Error(friendly(error.message, "Gagal mencatat pembayaran & mengirim"));
  return data as unknown as {
    already: boolean;
    order_id: string;
    sale_id: string;
    ledger_id: string | null;
    message_id: string;
    number: string;
    total: number;
    paid: number;
  };
}
