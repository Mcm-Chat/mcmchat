import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";
import { notifyIncomingCall } from "@/lib/push/push.functions";

export type CallRow = Tables<"calls">;
export type CallParticipantRow = Tables<"call_participants">;

/**
 * Lapisan sinyal panggilan MCM. Media real-time ditangani penyedia (LiveKit),
 * sedangkan status, peserta, durasi, dan riwayat selalu tersimpan nyata di
 * database sehingga kedua sisi melihat state yang sama.
 */
export const CALL_PROVIDER_NOTICE =
  "Penyedia panggilan belum terhubung. Riwayat panggilan tetap tercatat.";

export const RING_TIMEOUT_MS = 45_000;

/**
 * Panggilan dibuat lewat satu transaksi server (`create_call_tx`): baris
 * `calls` dan seluruh `call_participants` commit bersamaan, sehingga penerima
 * sudah menjadi peserta ketika event realtime INSERT terlihat. Peserta diambil
 * server dari anggota percakapan — klien tidak bisa menyisipkan orang lain.
 */
export async function startCall(
  conversationId: string,
  kind: CallRow["kind"],
  maxParticipants = 8,
) {
  const { data, error } = await supabase.rpc("create_call_tx", {
    _conversation: conversationId,
    _kind: kind,
    _max_participants: maxParticipants,
  });
  if (error) throw new Error(friendly(error.message, "Gagal memulai panggilan"));
  const call = data as unknown as CallRow;
  // Notifikasi panggilan masuk — gagal kirim tidak membatalkan panggilan.
  void notifyIncomingCall({ data: { callId: call.id } }).catch(() => undefined);
  return call;
}

export async function endCall(
  callId: string,
  status: CallRow["status"],
  durationSec: number,
  reason?: string,
) {
  const { error } = await supabase.rpc("end_call", {
    _call: callId,
    _status: status,
    _duration: Math.max(0, Math.round(durationSec)),
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw new Error(friendly(error.message, "Gagal mengakhiri panggilan"));
}

/**
 * Penerima menjawab lewat compare-and-set di server sehingga tap ganda,
 * pemanggil yang mencoba menjawab sendiri, atau panggilan yang sudah berakhir
 * tidak pernah menghasilkan state ganda.
 */
export async function answerCall(callId: string) {
  const { data, error } = await supabase.rpc("answer_call", { _call: callId });
  if (error) throw new Error(friendly(error.message, "Gagal menjawab panggilan"));
  return data as unknown as CallRow;
}

export async function declineCall(callId: string) {
  await endCall(callId, "declined", 0, "declined");
}

export async function leaveCall(callId: string, userId: string) {
  await supabase
    .from("call_participants")
    .update({ left_at: new Date().toISOString() })
    .eq("call_id", callId)
    .eq("user_id", userId);
}

/** Tandai panggilan berdering yang kedaluwarsa sebagai tak terjawab. */
export async function expireStaleCalls() {
  await supabase.rpc("expire_stale_calls");
}

export async function getCall(callId: string): Promise<CallRow | null> {
  const { data } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
  return data ?? null;
}

/**
 * Pemulihan panggilan masuk saat aplikasi kembali ke depan atau realtime baru
 * tersambung: event INSERT yang terlewat tetap muncul karena kita membaca
 * ulang panggilan `ringing` yang masih hidup.
 */
export async function listRingingCalls(userId: string): Promise<CallRow[]> {
  await expireStaleCalls().catch(() => undefined);
  const since = new Date(Date.now() - RING_TIMEOUT_MS).toISOString();
  const { data } = await supabase
    .from("calls")
    .select("*")
    .eq("status", "ringing")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? []).filter((c) => c.initiator_id !== userId);
}

/** Ikuti perubahan satu panggilan (dijawab, ditolak, berakhir) secara realtime. */
export function subscribeCall(callId: string, onChange: (row: CallRow) => void) {
  const ch = supabase
    .channel(`call:${callId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${callId}` },
      (p) => onChange(p.new as CallRow),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

/**
 * Panggilan masuk untuk pengguna ini. Filter dilakukan berdasarkan baris
 * `calls` baru berstatus `ringing`; RLS memastikan hanya peserta yang menerima.
 */
export function subscribeIncomingCalls(userId: string, onIncoming: (call: CallRow) => void) {
  const ch = supabase
    .channel(`incoming-calls:${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls" }, (p) => {
      const row = p.new as CallRow;
      if (row.status === "ringing" && row.initiator_id !== userId) onIncoming(row);
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(ch);
  };
}

export type CallParticipantProfile = {
  user_id: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  avatar_version: number;
};

export type CallHistoryItem = CallRow & { participants: CallParticipantProfile[] };

export async function listCalls(userId: string): Promise<CallHistoryItem[]> {
  const mine = unwrap(
    await supabase.from("call_participants").select("call_id").eq("user_id", userId),
    "Gagal memuat panggilan",
  );
  if (mine.length === 0) return [];
  const ids = mine.map((m) => m.call_id);
  const [calls, parts] = await Promise.all([
    supabase
      .from("calls")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("call_participants").select("call_id, user_id").in("call_id", ids),
  ]);
  const profileIds = [...new Set((parts.data ?? []).map((p) => p.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_color, avatar_url, avatar_version")
    .in("id", profileIds);
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (calls.data ?? []).map((c) => ({
    ...c,
    participants: (parts.data ?? [])
      .filter((p) => p.call_id === c.id)
      .map((p) => ({
        user_id: p.user_id,
        display_name: pmap.get(p.user_id)?.display_name ?? "Pengguna",
        avatar_color: pmap.get(p.user_id)?.avatar_color ?? "#0ea5e9",
        avatar_url: pmap.get(p.user_id)?.avatar_url ?? null,
        avatar_version: pmap.get(p.user_id)?.avatar_version ?? 0,
      })),
  }));
}
