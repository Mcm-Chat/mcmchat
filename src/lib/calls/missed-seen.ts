/**
 * Penanda kapan panggilan tak terjawab terakhir dilihat.
 *
 * Stempel disimpan PER JENIS panggilan (suara dan video) supaya badge di
 * navigasi bawah berperilaku sama untuk keduanya: panggilan video tak
 * terjawab menaikkan badge dan ikut hilang saat ditandai sudah dilihat.
 * Format lama (satu angka) tetap dibaca agar pengguna lama tidak melihat
 * badge lama muncul kembali.
 */
import { useSyncExternalStore } from "react";
import { onAccountSwitch, scopedKey } from "@/lib/session-scope";

const NAME = "calls.missed-seen-at";

export type CallKind = "audio" | "video";
export type MissedSeenMap = Record<CallKind, number>;

const EMPTY: MissedSeenMap = { audio: 0, video: 0 };

const listeners = new Set<() => void>();
let cache: MissedSeenMap | null = null;
let cacheKey = "";
let browserListenersReady = false;

function emitChange() {
  for (const listener of listeners) listener();
}

function invalidate() {
  cache = null;
  cacheKey = "";
  emitChange();
}

function ensureBrowserListeners() {
  if (browserListenersReady || typeof window === "undefined") return;
  browserListenersReady = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== scopedKey(NAME)) return;
    invalidate();
  });
  onAccountSwitch(() => invalidate());
}

const num = (value: unknown): number => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Terima format lama (angka) maupun baru (peta per jenis). */
export function parseMissedSeen(raw: string | null): MissedSeenMap {
  if (!raw) return { ...EMPTY };
  const legacy = Number(raw);
  if (Number.isFinite(legacy) && raw.trim() !== "" && !raw.trim().startsWith("{")) {
    return { audio: num(legacy), video: num(legacy) };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MissedSeenMap>;
    return { audio: num(parsed?.audio), video: num(parsed?.video) };
  } catch {
    return { ...EMPTY };
  }
}

function read(): MissedSeenMap {
  const storageKey = scopedKey(NAME);
  if (typeof localStorage === "undefined") return EMPTY;
  if (cache !== null && cacheKey === storageKey) return cache;
  cache = parseMissedSeen(localStorage.getItem(storageKey));
  cacheKey = storageKey;
  return cache;
}

/**
 * Tandai panggilan tak terjawab sudah dilihat. Tanpa argumen `kind`,
 * KEDUA jenis (suara dan video) ikut ditandai.
 */
export function markMissedCallsSeen(at: number = Date.now(), kind?: CallKind) {
  if (typeof localStorage === "undefined") return;
  const storageKey = scopedKey(NAME);
  const current = read();
  const next: MissedSeenMap = kind ? { ...current, [kind]: at } : { audio: at, video: at };
  localStorage.setItem(storageKey, JSON.stringify(next));
  cache = next;
  cacheKey = storageKey;
  emitChange();
}

export function getMissedCallsSeenAt(kind?: CallKind): number {
  const map = read();
  if (kind) return map[kind];
  return Math.min(map.audio, map.video);
}

function subscribe(listener: () => void) {
  ensureBrowserListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: MissedSeenMap = EMPTY;

/** Peta stempel "sudah dilihat" per jenis panggilan, reaktif. */
export function useMissedCallsSeen(): MissedSeenMap {
  return useSyncExternalStore(subscribe, read, () => SERVER_SNAPSHOT);
}

/** Apakah panggilan tak terjawab ini belum dilihat (berlaku suara & video). */
export function isMissedUnseen(
  seen: MissedSeenMap,
  call: { kind?: string | null; created_at: string },
): boolean {
  const kind: CallKind = call.kind === "video" ? "video" : "audio";
  return new Date(call.created_at).getTime() > seen[kind];
}
