/** Riwayat ekspor pembayaran (lokal, per perangkat) agar bisa diunduh ulang. */
export type ExportHistoryEntry = {
  receipt: string;
  ledgerId: string;
  ledgerName: string;
  format: "csv" | "pdf";
  fileName: string;
  at: string;
};

const KEY = "mcm.ledger.export-history.v1";
const MAX = 20;

function readAll(): ExportHistoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ExportHistoryEntry =>
        !!e && typeof e === "object" && typeof (e as ExportHistoryEntry).receipt === "string",
    );
  } catch {
    return [];
  }
}

function writeAll(entries: ExportHistoryEntry[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    /* kuota penuh — abaikan */
  }
}

export function listExportHistory(ledgerId?: string): ExportHistoryEntry[] {
  const all = readAll();
  return ledgerId ? all.filter((e) => e.ledgerId === ledgerId) : all;
}

export function recordExport(entry: ExportHistoryEntry) {
  const next = [entry, ...readAll().filter((e) => e.receipt !== entry.receipt)];
  writeAll(next);
  return next.filter((e) => e.ledgerId === entry.ledgerId);
}

export function removeExport(receipt: string) {
  const next = readAll().filter((e) => e.receipt !== receipt);
  writeAll(next);
  return next;
}

export function clearExportHistory(ledgerId?: string) {
  writeAll(ledgerId ? readAll().filter((e) => e.ledgerId !== ledgerId) : []);
}
