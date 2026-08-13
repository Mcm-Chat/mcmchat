import { OPEN_STATUSES, remaining, type LedgerRow } from "./ledger";

/** Arah catatan dari sudut pandang pengguna yang login (baris bisa milik pihak lawan). */
export function perspectiveType(l: LedgerRow, userId: string): LedgerRow["type"] {
  const mine = l.owner_id === userId;
  if (mine) return l.type;
  return l.type === "receivable" ? "payable" : "receivable";
}

const TZ = "Asia/Jakarta";
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));

export type DailySummary = {
  day: string;
  iso: string;
  newReceivable: number;
  newPayable: number;
  paid: number;
  count: number;
};

/** Ringkasan harian: catatan baru per arah + total pembayaran tercatat pada hari itu. */
export function dailySummary(rows: LedgerRow[], userId: string, days = 14): DailySummary[] {
  const map = new Map<string, DailySummary>();
  for (const l of rows) {
    const key = dayKey(l.created_at);
    const entry = map.get(key) ?? {
      day: key,
      iso: l.created_at,
      newReceivable: 0,
      newPayable: 0,
      paid: 0,
      count: 0,
    };
    const type = perspectiveType(l, userId);
    const amount = Number(l.amount);
    if (type === "receivable") entry.newReceivable += amount;
    else entry.newPayable += amount;
    entry.paid += Number(l.paid_amount);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, days);
}

export type ContactSummary = {
  key: string;
  name: string;
  receivable: number;
  payable: number;
  net: number;
  openCount: number;
  overdueCount: number;
  lastAt: string;
};

/** Saldo terbaru per kontak: sisa piutang, sisa utang, dan posisi bersih. */
export function contactSummary(rows: LedgerRow[], userId: string): ContactSummary[] {
  const map = new Map<string, ContactSummary>();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  for (const l of rows) {
    const mine = l.owner_id === userId;
    const key = (mine ? (l.counterpart_user_id ?? l.counterpart_name) : l.owner_id) || l.id;
    const entry = map.get(key) ?? {
      key,
      name: l.counterpart_name || "Tanpa nama",
      receivable: 0,
      payable: 0,
      net: 0,
      openCount: 0,
      overdueCount: 0,
      lastAt: l.created_at,
    };
    if (new Date(l.created_at).getTime() > new Date(entry.lastAt).getTime())
      entry.lastAt = l.created_at;
    if (OPEN_STATUSES.includes(l.status)) {
      const sisa = remaining(l);
      if (perspectiveType(l, userId) === "receivable") entry.receivable += sisa;
      else entry.payable += sisa;
      entry.openCount += 1;
      if (l.due_date && new Date(l.due_date).getTime() < startOfToday.getTime())
        entry.overdueCount += 1;
    }
    entry.net = entry.receivable - entry.payable;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}
