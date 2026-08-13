import { supabase } from "@/integrations/supabase/client";
import type { LedgerRow } from "./ledger";
import { OPEN_STATUSES, remaining } from "./ledger";
import type { SalesRecordRow } from "./sales";

/** Ringkasan keuangan untuk beranda Keuangan: piutang/utang terbuka, jatuh tempo, dan penjualan. */
export function financeSummary(ledgers: LedgerRow[], sales: SalesRecordRow[]) {
  const open = ledgers.filter((l) => OPEN_STATUSES.includes(l.status));
  const receivable = open
    .filter((l) => l.type === "receivable")
    .reduce((s, l) => s + remaining(l), 0);
  const payable = open.filter((l) => l.type === "payable").reduce((s, l) => s + remaining(l), 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueLedgers = open.filter((l) => l.due_date && new Date(l.due_date).getTime() <= Date.now());
  const overdue = dueLedgers.filter(
    (l) => l.due_date && new Date(l.due_date).getTime() < today.getTime(),
  );

  const startOfDay = today.getTime();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const salesToday = sales
    .filter((s) => new Date(s.created_at).getTime() >= startOfDay)
    .reduce((s, r) => s + Number(r.total), 0);
  const salesMonth = sales
    .filter((s) => new Date(s.created_at).getTime() >= startOfMonth)
    .reduce((s, r) => s + Number(r.total), 0);

  return {
    receivable,
    payable,
    dueCount: dueLedgers.length,
    overdueCount: overdue.length,
    salesToday,
    salesMonth,
  };
}

export type SalesPayloadItem = { name: string; qty: number; price: number; discount: number };
export type SalesPayload = { number: string; customerName: string; items: SalesPayloadItem[] };

export function salesPayload(row: SalesRecordRow): SalesPayload {
  const p = (row.payload ?? {}) as Partial<SalesPayload>;
  return {
    number: p.number ?? "-",
    customerName: p.customerName ?? "Pelanggan",
    items: Array.isArray(p.items) ? (p.items as SalesPayloadItem[]) : [],
  };
}

export async function getSaleDetail(id: string) {
  const { data, error } = await supabase
    .from("sales_records")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Gagal memuat rincian penjualan");
  return data;
}
