import { useCallback, useEffect, useState } from "react";
import { sendMessage } from "./chat";
import { loadEntries, saveEntries } from "./outbox-store";
import { backoffDelay, getConnectionState, onConnectionChange } from "@/lib/realtime/connection";

/**
 * Antrean kirim (outbox) yang tahan offline.
 *
 * Setiap pesan punya `clientId` yang dibuat perangkat. Kolom
 * `messages.client_id` unik per (percakapan, pengirim), jadi percobaan kirim
 * ulang setelah reconnect tidak pernah membuat pesan ganda — duplikat ditolak
 * database dan dianggap sukses oleh outbox.
 *
 * Antrean disimpan di IndexedDB (fallback localStorage). Batasan jujur: hanya
 * pesan teks yang bertahan lintas reload — lampiran biner tidak diantrekan.
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
  /** Error permanen (izin/validasi): tidak pernah dicoba ulang otomatis. */
  permanent?: boolean;
};

let queue: OutboxEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function persist() {
  void saveEntries(queue).catch(() => undefined);
}

function emit() {
  persist();
  for (const l of listeners) l();
}

/**
 * Pemuatan awal bersifat async (IndexedDB). Entri yang sudah antre di memori
 * pada sesi ini menang atas salinan tersimpan agar tidak ada duplikasi.
 */
export async function hydrateOutbox(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const stored = await loadEntries().catch(() => []);
  const known = new Set(queue.map((e) => e.clientId));
  const restored = stored.filter((e) => !known.has(e.clientId)).map((e) => ({ ...e, status: "failed" as const }));
  if (restored.length > 0) {
    queue = [...restored, ...queue];
    emit();
  }
}

function load() {
  if (!loaded) void hydrateOutbox();
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

/**
 * Error yang tidak akan pernah sembuh dengan mencoba lagi (RLS/izin, validasi,
 * percakapan hilang). Entri seperti ini berhenti otomatis dan menunggu
 * keputusan pengguna, supaya tidak berputar tanpa batas.
 */
function isPermanentError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("tidak memiliki akses") ||
    m.includes("row-level security") ||
    m.includes("permission denied") ||
    m.includes("violates foreign key") ||
    m.includes("invalid input") ||
    m.includes("not-null")
  );
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
    entry.permanent = isPermanentError(message);
    emit();
    if (!entry.permanent && entry.attempts < 6) {
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
  entry.permanent = false;
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
  for (const entry of queue) if (entry.status !== "sending" && !entry.permanent) void attempt(entry.clientId);
}

let flushWired = false;

export function initOutboxFlush(): () => void {
  if (flushWired) return () => undefined;
  flushWired = true;
  void hydrateOutbox().then(() => {
    if (getConnectionState() !== "offline") flushOutbox();
  });
  let previous = getConnectionState();
  const off = onConnectionChange((next) => {
    if (next === "online" && previous !== "online") flushOutbox();
    previous = next;
  });
  // Kembali ke foreground juga memicu pengiriman ulang.
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible" && getConnectionState() !== "offline") flushOutbox();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
  return () => {
    off();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
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