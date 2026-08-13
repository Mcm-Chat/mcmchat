import type { OutboxEntry } from "./outbox";

/**
 * Penyimpanan outbox: IndexedDB bila tersedia, `localStorage` sebagai cadangan.
 *
 * IndexedDB dipilih karena kuotanya jauh lebih besar dan penulisannya tidak
 * memblokir thread UI; localStorage tetap dipertahankan agar antrean tidak
 * hilang di WebView lama atau saat IDB diblokir (mis. mode privat tertentu).
 */
const DB_NAME = "mcm";
const STORE = "outbox";
const lsKey = (userId: string) => `mcm:${userId}:outbox.v1`;
/** Versi skema entri. Entri dengan versi lain/rusak dibuang saat dimuat. */
export const OUTBOX_SCHEMA = 1;

/** Buang entri rusak/versi lama supaya antrean tidak macet oleh data invalid. */
export function sanitizeEntries(input: unknown): OutboxEntry[] {
  if (!Array.isArray(input)) return [];
  return input.filter((e): e is OutboxEntry => {
    if (!e || typeof e !== "object") return false;
    const v = e as Partial<OutboxEntry> & { schema?: number };
    if (v.schema !== undefined && v.schema !== OUTBOX_SCHEMA) return false;
    return (
      typeof v.clientId === "string" &&
      typeof v.conversationId === "string" &&
      typeof v.senderId === "string" &&
      typeof v.body === "string" &&
      typeof v.createdAt === "string"
    );
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: "clientId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function readLocal(userId: string): OutboxEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return sanitizeEntries(JSON.parse(localStorage.getItem(lsKey(userId)) ?? "[]")).filter(
      (e) => e.senderId === userId,
    );
  } catch {
    return [];
  }
}

function writeLocal(userId: string, entries: OutboxEntry[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(lsKey(userId), JSON.stringify(entries));
  } catch {
    /* kuota penuh: antrean tetap hidup di memori sesi ini */
  }
}

/** Antrean selalu dibaca/ditulis per akun: entri akun lain tidak pernah ikut. */
export async function loadEntries(userId: string): Promise<OutboxEntry[]> {
  if (!idbAvailable()) return readLocal(userId);
  try {
    const db = await openDb();
    const fromIdb = sanitizeEntries(
      await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as unknown[]);
        req.onerror = () => reject(req.error);
      }),
    ).filter((e) => e.senderId === userId);
    // Migrasi satu kali dari penyimpanan lama.
    const legacy = readLocal(userId);
    if (legacy.length > 0) {
      const known = new Set(fromIdb.map((e) => e.clientId));
      const merged = [...fromIdb, ...legacy.filter((e) => !known.has(e.clientId))];
      await saveEntries(userId, merged);
      writeLocal(userId, []);
      return merged;
    }
    return fromIdb;
  } catch {
    return readLocal(userId);
  }
}

export async function saveEntries(userId: string, entries: OutboxEntry[]): Promise<void> {
  const own = entries.filter((e) => e.senderId === userId);
  if (!idbAvailable()) {
    writeLocal(userId, own);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        for (const row of (req.result ?? []) as OutboxEntry[]) {
          if (row.senderId === userId) store.delete(row.clientId);
        }
        for (const e of own) store.put({ ...e, schema: OUTBOX_SCHEMA });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    writeLocal(userId, own);
  }
}

/** Hapus seluruh antrean milik satu akun (dipakai saat logout / ganti akun). */
export async function clearEntries(userId: string): Promise<void> {
  await saveEntries(userId, []);
}
