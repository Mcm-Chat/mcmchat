/**
 * Penanda kapan daftar panggilan terakhir dibuka.
 *
 * Badge "tak terjawab" di navigasi bawah hanya menghitung panggilan yang
 * masuk setelah stempel ini, jadi badge hilang begitu halaman Panggilan
 * dibuka dan hanya muncul lagi untuk panggilan baru.
 */
import { useSyncExternalStore } from "react";
import { scopedKey } from "@/lib/session-scope";

const NAME = "calls.missed-seen-at";
const listeners = new Set<() => void>();
let cache: number | null = null;
let cacheKey = "";

function read(): number {
  const key = scopedKey(NAME);
  if (typeof localStorage === "undefined") return 0;
  if (cache !== null && cacheKey === key) return cache;
  const raw = localStorage.getItem(key);
  const value = raw ? Number(raw) : 0;
  cache = Number.isFinite(value) ? value : 0;
  cacheKey = key;
  return cache;
}

export function markMissedCallsSeen(at: number = Date.now()) {
  if (typeof localStorage === "undefined") return;
  const key = scopedKey(NAME);
  localStorage.setItem(key, String(at));
  cache = at;
  cacheKey = key;
  for (const l of listeners) l();
}

export function getMissedCallsSeenAt(): number {
  return read();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMissedCallsSeenAt(): number {
  return useSyncExternalStore(
    subscribe,
    () => read(),
    () => 0,
  );
}
