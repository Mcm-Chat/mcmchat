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
  /** Status channel ini sendiri; status global adalah agregat semua channel. */
  status: "connecting" | "online" | "error";
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  refs: number;
  closed: boolean;
};

const managed = new Map<string, Managed>();

function browserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Status global dihitung ulang dari seluruh channel, bukan ditimpa oleh channel
 * terakhir yang berubah. Tanpa ini, satu channel yang berhasil menyambung
 * membuat indikator hijau padahal channel pesan masih putus.
 */
function recompute() {
  if (browserOffline()) {
    setState("offline");
    return;
  }
  if (managed.size === 0) {
    setState("online");
    return;
  }
  const all = [...managed.values()];
  if (all.every((e) => e.status === "online")) setState("online");
  else setState("connecting");
}

function teardown(entry: Managed) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (entry.channel) void supabase.removeChannel(entry.channel);
  entry.channel = null;
}

function connect(entry: Managed) {
  if (entry.closed) return;
  teardown(entry);
  entry.status = "connecting";
  recompute();
  const channel = entry.factory(`${entry.key}#${entry.attempt}`);
  entry.channel = channel;
  channel.subscribe((status) => {
    if (entry.closed) return;
    if (status === "SUBSCRIBED") {
      entry.attempt = 0;
      entry.status = "online";
      recompute();
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      entry.status = "error";
      recompute();
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
    entry = { key, factory, channel: null, status: "connecting", attempt: 0, timer: null, refs: 0, closed: false };
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
    recompute();
  };
}

/** Paksa semua langganan tersambung ulang (dipakai saat online kembali / token refresh). */
export function reconnectAll() {
  for (const entry of managed.values()) {
    entry.attempt = 0;
    connect(entry);
  }
  recompute();
}

let wired = false;

/** Dipasang sekali di root: online/offline browser + re-auth realtime saat token diperbarui. */
export function initConnectionWatcher(): () => void {
  if (typeof window === "undefined" || wired) return () => undefined;
  wired = true;

  const goOnline = () => {
    reconnectAll();
  };
  const goOffline = () => setState("offline");
  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  recompute();

  // Supabase memancarkan SIGNED_IN berulang (mis. saat tab kembali fokus).
  // Menyambung ulang hanya ketika token benar-benar berubah mencegah siklus
  // resubscribe tak berujung yang membuat pesan hilang di tengah jalan.
  let lastToken: string | null = null;
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
    const token = session?.access_token ?? null;
    if (token === lastToken) return;
    lastToken = token;
    if (token) supabase.realtime.setAuth(token);
    reconnectAll();
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