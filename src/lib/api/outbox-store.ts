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
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]).filter((e) => typeof e?.clientId === "string") : [];
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
    const fromIdb = await new Promise<OutboxEntry[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as OutboxEntry[]);
      req.onerror = () => reject(req.error);
    });
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
      for (const e of entries) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    writeLocal(entries);
  }
}