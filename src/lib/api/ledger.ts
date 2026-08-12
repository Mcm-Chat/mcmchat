import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type LedgerRow = Tables<"ledgers">;
export type LedgerPaymentRow = Tables<"ledger_payments">;
export type LedgerEventRow = Tables<"ledger_events">;

export const LEDGER_STATUS_LABEL: Record<LedgerRow["status"], string> = {
  pending_approval: "Menunggu persetujuan",
  active: "Aktif",
  partially_paid: "Dibayar sebagian",
  paid: "Lunas",
  rejected: "Ditolak",
  disputed: "Disengketakan",
  cancelled: "Dibatalkan",
};

export const remaining = (l: LedgerRow) => Math.max(0, Number(l.amount) - Number(l.paid_amount));

export const OPEN_STATUSES: LedgerRow["status"][] = ["pending_approval", "active", "partially_paid", "disputed"];

export async function listLedgers(userId: string): Promise<LedgerRow[]> {
  return unwrap(
    await supabase
      .from("ledgers")
      .select("*")
      .or(`owner_id.eq.${userId},counterpart_user_id.eq.${userId}`)
      .order("created_at", { ascending: false }),
    "Gagal memuat catatan",
  );
}

export async function getLedger(id: string) {
  const ledger = unwrap(await supabase.from("ledgers").select("*").eq("id", id).maybeSingle(), "Catatan tidak ditemukan");
  const [payments, events] = await Promise.all([
    supabase.from("ledger_payments").select("*").eq("ledger_id", id).order("paid_at", { ascending: false }),
    supabase.from("ledger_events").select("*").eq("ledger_id", id).order("created_at", { ascending: false }),
  ]);
  return { ledger, payments: payments.data ?? [], events: events.data ?? [] };
}

export type CreateLedgerInput = {
  ownerId: string;
  counterpartUserId: string | null;
  counterpartName: string;
  type: LedgerRow["type"];
  amount: number;
  dueDate?: string | null;
  note?: string;
  salesRecordId?: string | null;
  conversationId?: string | null;
  paidAmount?: number;
  status?: LedgerRow["status"];
};

export async function createLedger(input: CreateLedgerInput): Promise<LedgerRow> {
  if (!(input.amount > 0)) throw new Error("Nominal harus lebih dari nol");
  const paid = Math.min(input.paidAmount ?? 0, input.amount);
  const status = input.status ?? (paid >= input.amount ? "paid" : paid > 0 ? "partially_paid" : "active");
  const row = unwrap(
    await supabase
      .from("ledgers")
      .insert({
        owner_id: input.ownerId,
        counterpart_user_id: input.counterpartUserId,
        counterpart_name: input.counterpartName,
        type: input.type,
        amount: input.amount,
        paid_amount: paid,
        due_date: input.dueDate ?? null,
        note: input.note ?? "",
        sales_record_id: input.salesRecordId ?? null,
        conversation_id: input.conversationId ?? null,
        status,
      })
      .select("*")
      .single(),
    "Gagal membuat catatan",
  );
  await supabase.from("ledger_events").insert({ ledger_id: row.id, actor_id: input.ownerId, label: "Catatan dibuat", detail: input.note ?? "" });
  return row;
}

/** Pembayaran parsial atomik lewat fungsi database (tidak bisa melebihi sisa tagihan). */
export async function recordPayment(ledgerId: string, amount: number, method: string, note: string) {
  const { data, error } = await supabase.rpc("record_ledger_payment", {
    _ledger: ledgerId,
    _amount: amount,
    _method: method,
    _note: note,
  });
  if (error) throw new Error(friendly(error.message, "Pembayaran gagal dicatat"));
  return data as unknown as LedgerRow;
}

export async function updateStatus(ledgerId: string, status: LedgerRow["status"], actorId: string) {
  const { error } = await supabase.from("ledgers").update({ status }).eq("id", ledgerId);
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui status"));
  await supabase.from("ledger_events").insert({ ledger_id: ledgerId, actor_id: actorId, label: `Status: ${LEDGER_STATUS_LABEL[status]}` });
}

export function totals(rows: LedgerRow[]) {
  const open = rows.filter((l) => OPEN_STATUSES.includes(l.status));
  const receivable = open.filter((l) => l.type === "receivable").reduce((s, l) => s + remaining(l), 0);
  const payable = open.filter((l) => l.type === "payable").reduce((s, l) => s + remaining(l), 0);
  const dueSoon = open.filter((l) => l.due_date && (new Date(l.due_date).getTime() - Date.now()) / 86400000 <= 7);
  return { receivable, payable, dueSoon, open };
}
