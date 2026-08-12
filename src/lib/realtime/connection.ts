import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Manajer koneksi realtime tunggal untuk seluruh aplikasi.
 *
 * Masalah nyata yang diperbaiki:
 * - Setiap layar membuat channel sendiri tanpa penjaga duplikasi.
 * - Tidak ada resubscribe setelah WebSocket putus → chat baru hanya muncul
 *   setelah refresh manual.
 * - Token Supabase yang di-refresh tidak pernah diteruskan ke socket realtime,
 *   sehingga langganan diam-diam kehilangan izin RLS.
 */
export type ConnectionState = "online" | "connecting" | "offline";

type Listener = (state: ConnectionState) => void;

const listeners = new Set<Listener>();
let state: ConnectionState = "connecting";

function setState(next: ConnectionState) {
  if (next === state) return;
  state = next;
  for (const l of listeners) l(next);
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function onConnectionChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Backoff eksponensial dengan jitter penuh (maks 30 detik). */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + random() * (base / 2));
}

export type SubscriptionFactory = (channelName: string) => RealtimeChannel;

type Managed = {
  key: string;
  factory: SubscriptionFactory;
  channel: RealtimeChannel | null;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  refs: number;
  closed: boolean;
};

const managed = new Map<string, Managed>();

function teardown(entry: Managed) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (entry.channel) void supabase.removeChannel(entry.channel);
  entry.channel = null;
}

function connect(entry: Managed) {
  if (entry.closed) return;
  teardown(entry);
  setState(entry.attempt === 0 ? "connecting" : state === "online" ? "connecting" : state);
  const channel = entry.factory(`${entry.key}#${entry.attempt}`);
  entry.channel = channel;
  channel.subscribe((status) => {
    if (entry.closed) return;
    if (status === "SUBSCRIBED") {
      entry.attempt = 0;
      setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online");
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "connecting");
      const delay = backoffDelay(entry.attempt);
      entry.attempt += 1;
      entry.timer = setTimeout(() => connect(entry), delay);
    }
  });
}

/**
 * Daftarkan langganan realtime bernama. Pemanggilan berulang dengan `key` yang
 * sama hanya memakai satu channel (ref-counted) sehingga tidak ada listener ganda.
 */
export function registerSubscription(key: string, factory: SubscriptionFactory): () => void {
  let entry = managed.get(key);
  if (!entry) {
    entry = { key, factory, channel: null, attempt: 0, timer: null, refs: 0, closed: false };
    managed.set(key, entry);
    connect(entry);
  }
  entry.refs += 1;
  return () => {
    const current = managed.get(key);
    if (!current) return;
    current.refs -= 1;
    if (current.refs > 0) return;
    current.closed = true;
    teardown(current);
    managed.delete(key);
  };
}

/** Paksa semua langganan tersambung ulang (dipakai saat online kembali / token refresh). */
export function reconnectAll() {
  for (const entry of managed.values()) {
    entry.attempt = 0;
    connect(entry);
  }
  if (managed.size === 0) setState(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online");
}

let wired = false;

/** Dipasang sekali di root: online/offline browser + re-auth realtime saat token diperbarui. */
export function initConnectionWatcher(): () => void {
  if (typeof window === "undefined" || wired) return () => undefined;
  wired = true;

  const goOnline = () => {
    setState("connecting");
    reconnectAll();
  };
  const goOffline = () => setState("offline");
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  if (navigator.onLine === false) setState("offline");

  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
      reconnectAll();
    }
  });

  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
    sub.subscription.unsubscribe();
    wired = false;
  };
}

export function useConnectionState(): ConnectionState {
  const [value, setValue] = useState<ConnectionState>(getConnectionState);
  useEffect(() => onConnectionChange(setValue), []);
  return value;
}