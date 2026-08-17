/**
 * Riwayat hasil pindai QR (lokal, per akun) dengan retensi 7 hari.
 * Disimpan di localStorage agar tetap ada saat offline dan tidak pernah
 * membocorkan data ke perangkat lain.
 */
export type ScanHistoryEntry = {
  id: string;
  pin: string;
  name: string;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  avatarVersion?: number | null;
  scannedAt: number;
};

export const SCAN_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20;

const scopedKey = (userId: string) => `mcm:${userId}:scan-history.v1`;

const fresh = (list: ScanHistoryEntry[], now: number) =>
  list.filter((e) => e && typeof e.pin === "string" && now - e.scannedAt < SCAN_HISTORY_TTL_MS);

export function readScanHistory(userId: string, now: number = Date.now()): ScanHistoryEntry[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScanHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return fresh(parsed, now).sort((a, b) => b.scannedAt - a.scannedAt);
  } catch {
    return [];
  }
}

function write(userId: string, list: ScanHistoryEntry[]) {
  try {
    window.localStorage.setItem(scopedKey(userId), JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* kuota penuh: riwayat bersifat opsional */
  }
}

/** Catat hasil pindai; entri lama untuk kontak yang sama diperbarui. */
export function recordScan(
  userId: string,
  entry: Omit<ScanHistoryEntry, "scannedAt">,
  now: number = Date.now(),
): ScanHistoryEntry[] {
  if (typeof window === "undefined" || !userId) return [];
  const next = [
    { ...entry, scannedAt: now },
    ...readScanHistory(userId, now).filter((e) => e.id !== entry.id),
  ];
  write(userId, next);
  return next.slice(0, MAX_ENTRIES);
}

export function removeScan(userId: string, id: string): ScanHistoryEntry[] {
  const next = readScanHistory(userId).filter((e) => e.id !== id);
  if (typeof window !== "undefined" && userId) write(userId, next);
  return next;
}

export function clearScanHistory(userId: string): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.removeItem(scopedKey(userId));
  } catch {
    /* diabaikan */
  }
}

/** Label relatif singkat, mis. "baru saja", "3 jam lalu", "2 hari lalu". */
export function scanAgeLabel(scannedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - scannedAt);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} menit lalu`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} jam lalu`;
  return `${Math.floor(hour / 24)} hari lalu`;
}
