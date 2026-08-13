/**
 * Ruang lingkup data lokal per akun.
 *
 * Semua data sensitif yang tersimpan di perangkat (draf, token tugas, antrean
 * outbox, cache signed URL) harus terikat pada `auth.uid()` yang sedang aktif.
 * Saat akun berganti di perangkat yang sama, data akun sebelumnya dihapus
 * sehingga tidak ada kebocoran antar akun.
 */
const PREFIX = "mcm:";
/** Key lama (global, tidak ter-namespace) yang harus dibersihkan sekali. */
const LEGACY_KEYS = ["mcm-prep-tokens", "mcm.outbox.v1"];

let activeUserId: string | null = null;
const switchListeners = new Set<(next: string | null, previous: string | null) => void>();

export function getActiveUserId(): string | null {
  return activeUserId;
}

/** `mcm:<userId>:<name>` — tanpa akun aktif, gunakan ruang anonim. */
export function scopedKey(name: string, userId: string | null = activeUserId): string {
  return `${PREFIX}${userId ?? "anon"}:${name}`;
}

export function onAccountSwitch(fn: (next: string | null, previous: string | null) => void): () => void {
  switchListeners.add(fn);
  return () => switchListeners.delete(fn);
}

/** Hapus seluruh key localStorage milik satu akun (plus key legacy global). */
export function purgeLocalScope(userId: string | null) {
  if (typeof localStorage === "undefined") return;
  const scope = `${PREFIX}${userId ?? "anon"}:`;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith(scope) || LEGACY_KEYS.includes(key)) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
}

/**
 * Dipanggil setiap kali sesi Supabase berubah. Mengembalikan `true` bila
 * identitas akun benar-benar berganti (termasuk logout).
 */
export function setActiveUser(next: string | null): boolean {
  if (next === activeUserId) return false;
  const previous = activeUserId;
  activeUserId = next;
  if (previous) purgeLocalScope(previous);
  for (const fn of switchListeners) fn(next, previous);
  return true;
}

/** Hanya untuk pengujian. */
export function __resetSessionScope() {
  activeUserId = null;
  switchListeners.clear();
}
