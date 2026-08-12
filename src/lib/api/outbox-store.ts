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
const LS_KEY = "mcm.outbox.v1";
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
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function readLocal(): OutboxEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return sanitizeEntries(JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeLocal(entries: OutboxEntry[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    /* kuota penuh: antrean tetap hidup di memori sesi ini */
  }
}

export async function loadEntries(): Promise<OutboxEntry[]> {
  if (!idbAvailable()) return readLocal();
  try {
    const db = await openDb();
    const fromIdb = sanitizeEntries(
      await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result ?? []) as unknown[]);
        req.onerror = () => reject(req.error);
      }),
    );
    // Migrasi satu kali dari penyimpanan lama.
    const legacy = readLocal();
    if (legacy.length > 0) {
      const known = new Set(fromIdb.map((e) => e.clientId));
      const merged = [...fromIdb, ...legacy.filter((e) => !known.has(e.clientId))];
      await saveEntries(merged);
      writeLocal([]);
      return merged;
    }
    return fromIdb;
  } catch {
    return readLocal();
  }
}

export async function saveEntries(entries: OutboxEntry[]): Promise<void> {
  if (!idbAvailable()) {
    writeLocal(entries);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      for (const e of entries) store.put({ ...e, schema: OUTBOX_SCHEMA });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    writeLocal(entries);
  }
}