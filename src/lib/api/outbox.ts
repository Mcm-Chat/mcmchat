import { useCallback, useEffect, useState } from "react";
import { sendMessage } from "./chat";
import { backoffDelay, getConnectionState, onConnectionChange } from "@/lib/realtime/connection";

/**
 * Antrean kirim (outbox) yang tahan offline.
 *
 * Setiap pesan punya `clientId` yang dibuat perangkat. Kolom
 * `messages.client_id` unik per (percakapan, pengirim), jadi percobaan kirim
 * ulang setelah reconnect tidak pernah membuat pesan ganda — duplikat ditolak
 * database dan dianggap sukses oleh outbox.
 *
 * Batasan jujur: hanya pesan teks yang bertahan lintas reload (lampiran biner
 * tidak disimpan di localStorage). Lampiran yang gagal tetap bisa dicoba ulang
 * selama sesi berjalan.
 */
export type OutboxEntry = {
  clientId: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  createdAt: string;
  attempts: number;
  status: "sending" | "failed";
  error?: string;
};

const STORAGE_KEY = "mcm.outbox.v1";

let queue: OutboxEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function persist() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* kuota penuh: antrean tetap hidup di memori */
  }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

function load() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) queue = parsed.filter((e): e is OutboxEntry => !!e && typeof (e as OutboxEntry).clientId === "string");
  } catch {
    queue = [];
  }
  for (const entry of queue) entry.status = "failed";
}

export function outboxFor(conversationId: string): OutboxEntry[] {
  load();
  return queue.filter((e) => e.conversationId === conversationId);
}

export function outboxSize(): number {
  load();
  return queue.length;
}

function isDuplicateError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("duplicate") || m.includes("sudah ada") || m.includes("unique");
}

let onSent: ((entry: OutboxEntry) => void) | null = null;

/** Dipanggil UI agar cache pesan disegarkan tepat setelah entri berhasil terkirim. */
export function setOutboxSentHandler(handler: ((entry: OutboxEntry) => void) | null) {
  onSent = handler;
}

async function attempt(clientId: string) {
  const entry = queue.find((e) => e.clientId === clientId);
  if (!entry) return;
  if (getConnectionState() === "offline") {
    entry.status = "failed";
    entry.error = "Offline";
    emit();
    return;
  }
  entry.status = "sending";
  emit();
  try {
    await sendMessage({
      conversationId: entry.conversationId,
      senderId: entry.senderId,
      body: entry.body,
      replyToId: entry.replyToId,
      clientId: entry.clientId,
    });
    queue = queue.filter((e) => e.clientId !== clientId);
    emit();
    onSent?.(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengirim";
    if (isDuplicateError(message)) {
      // Sudah tersimpan di server pada percobaan sebelumnya.
      queue = queue.filter((e) => e.clientId !== clientId);
      emit();
      onSent?.(entry);
      return;
    }
    entry.attempts += 1;
    entry.status = "failed";
    entry.error = message;
    emit();
    if (entry.attempts < 6) {
      const t = setTimeout(() => {
        timers.delete(clientId);
        void attempt(clientId);
      }, backoffDelay(entry.attempts));
      timers.set(clientId, t);
    }
  }
}

export function enqueueText(input: { conversationId: string; senderId: string; body: string; replyToId?: string | null }): OutboxEntry {
  load();
  const entry: OutboxEntry = {
    clientId: crypto.randomUUID(),
    conversationId: input.conversationId,
    senderId: input.senderId,
    body: input.body,
    replyToId: input.replyToId ?? null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "sending",
  };
  queue = [...queue, entry];
  emit();
  void attempt(entry.clientId);
  return entry;
}

export function retryEntry(clientId: string) {
  const entry = queue.find((e) => e.clientId === clientId);
  if (!entry) return;
  entry.attempts = 0;
  void attempt(clientId);
}

export function discardEntry(clientId: string) {
  const t = timers.get(clientId);
  if (t) clearTimeout(t);
  timers.delete(clientId);
  queue = queue.filter((e) => e.clientId !== clientId);
  emit();
}

/** Kirim ulang semua entri tertunda (dipanggil saat koneksi kembali). */
export function flushOutbox() {
  load();
  for (const entry of queue) if (entry.status !== "sending") void attempt(entry.clientId);
}

let flushWired = false;

export function initOutboxFlush(): () => void {
  if (flushWired) return () => undefined;
  flushWired = true;
  let previous = getConnectionState();
  const off = onConnectionChange((next) => {
    if (next === "online" && previous !== "online") flushOutbox();
    previous = next;
  });
  return () => {
    off();
    flushWired = false;
  };
}

export function useOutbox(conversationId: string): OutboxEntry[] {
  const [items, setItems] = useState<OutboxEntry[]>(() => outboxFor(conversationId));
  useEffect(() => {
    const update = () => setItems(outboxFor(conversationId));
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, [conversationId]);
  return items;
}

export const useOutboxActions = () => ({
  retry: useCallback((id: string) => retryEntry(id), []),
  discard: useCallback((id: string) => discardEntry(id), []),
});

/** Hanya untuk pengujian. */
export function __resetOutbox() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  queue = [];
  loaded = true;
  onSent = null;
}