import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type ReceiptRow = Pick<Tables<"message_receipts">, "message_id" | "user_id" | "delivered_at" | "read_at">;

/**
 * Status centang pesan keluar.
 * - `sent`      : tersimpan di server, belum ada delivery receipt lawan  → ✓
 * - `delivered` : minimal satu peserta lain punya `delivered_at`          → ✓✓ netral
 * - `read`      : semua peserta lain yang relevan punya `read_at`         → ✓✓ aksen
 *
 * Catatan grup: `read` hanya muncul bila SELURUH anggota lain sudah membaca.
 * Anggota yang mematikan laporan dibaca tidak pernah mengirim `read_at`,
 * sehingga status berhenti di `delivered` — tidak pernah menyesatkan.
 */
export type MessageStatus = "sent" | "delivered" | "read";

export function deriveStatus(receipts: ReceiptRow[], otherMemberCount: number): MessageStatus {
  if (receipts.length === 0) return "sent";
  const delivered = receipts.filter((r) => r.delivered_at != null);
  if (delivered.length === 0) return "sent";
  const read = receipts.filter((r) => r.read_at != null);
  if (otherMemberCount > 0 && read.length >= otherMemberCount) return "read";
  return "delivered";
}

/** Index receipts berdasarkan message_id untuk pencarian O(1) saat render. */
export function indexReceipts(rows: ReceiptRow[]): Map<string, ReceiptRow[]> {
  const map = new Map<string, ReceiptRow[]>();
  for (const r of rows) {
    const list = map.get(r.message_id);
    if (list) list.push(r);
    else map.set(r.message_id, [r]);
  }
  return map;
}

/** Ambil tanda terima untuk sekumpulan pesan (biasanya pesan milik saya). */
export async function listReceipts(messageIds: string[], excludeUserId?: string): Promise<ReceiptRow[]> {
  if (messageIds.length === 0) return [];
  const { data } = await supabase
    .from("message_receipts")
    .select("message_id, user_id, delivered_at, read_at")
    .in("message_id", messageIds);
  const rows = (data ?? []) as ReceiptRow[];
  return excludeUserId ? rows.filter((r) => r.user_id !== excludeUserId) : rows;
}

/** Catat `delivered_at` untuk semua pesan masuk di percakapan ini. */
export async function markDelivered(conversationId: string): Promise<void> {
  await supabase.rpc("mark_messages_delivered", { _conv: conversationId });
}

/**
 * Catat `read_at` (dan `delivered_at` bila kosong) untuk semua pesan masuk.
 * Server menghormati pengaturan privasi `readReceipts`: bila dimatikan, hanya
 * `delivered_at` yang ditulis.
 */
export async function markRead(conversationId: string): Promise<void> {
  await supabase.rpc("mark_messages_read", { _conv: conversationId });
}
