import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

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

export async function startCall(initiatorId: string, conversationId: string, kind: CallRow["kind"], participantIds: string[]) {
  const call = unwrap(
    await supabase
      .from("calls")
      .insert({
        initiator_id: initiatorId,
        conversation_id: conversationId,
        kind,
        status: "ringing",
        provider: "livekit",
        room_name: `mcm-${crypto.randomUUID()}`,
      })
      .select("*")
      .single(),
    "Gagal memulai panggilan",
  );
  const { error } = await supabase
    .from("call_participants")
    .insert([...new Set([initiatorId, ...participantIds])].map((id) => ({ call_id: call.id, user_id: id })));
  if (error) throw new Error(friendly(error.message, "Gagal menambahkan peserta"));
  return call;
}

export async function endCall(callId: string, status: CallRow["status"], durationSec: number, reason?: string) {
  const { error } = await supabase
    .from("calls")
    .update({
      status,
      duration_sec: Math.max(0, Math.round(durationSec)),
      ended_at: new Date().toISOString(),
      ...(reason ? { end_reason: reason } : {}),
    })
    .eq("id", callId);
  if (error) throw new Error(friendly(error.message, "Gagal mengakhiri panggilan"));
}

/** Penerima menjawab: status naik ke `ongoing` dan waktu jawab tercatat. */
export async function answerCall(callId: string, userId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("calls")
    .update({ status: "ongoing", answered_at: now, started_at: now })
    .eq("id", callId)
    .eq("status", "ringing");
  if (error) throw new Error(friendly(error.message, "Gagal menjawab panggilan"));
  await supabase.from("call_participants").update({ joined_at: now }).eq("call_id", callId).eq("user_id", userId);
}

export async function declineCall(callId: string) {
  await endCall(callId, "declined", 0, "declined");
}

export async function leaveCall(callId: string, userId: string) {
  await supabase.from("call_participants").update({ left_at: new Date().toISOString() }).eq("call_id", callId).eq("user_id", userId);
}

/** Tandai panggilan berdering yang kedaluwarsa sebagai tak terjawab. */
export async function expireStaleCalls() {
  await supabase.rpc("expire_stale_calls");
}

export async function getCall(callId: string): Promise<CallRow | null> {
  const { data } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
  return data ?? null;
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

export type CallHistoryItem = CallRow & { participants: { user_id: string; display_name: string; avatar_color: string }[] };

export async function listCalls(userId: string): Promise<CallHistoryItem[]> {
  const mine = unwrap(await supabase.from("call_participants").select("call_id").eq("user_id", userId), "Gagal memuat panggilan");
  if (mine.length === 0) return [];
  const ids = mine.map((m) => m.call_id);
  const [calls, parts] = await Promise.all([
    supabase.from("calls").select("*").in("id", ids).order("created_at", { ascending: false }).limit(100),
    supabase.from("call_participants").select("call_id, user_id").in("call_id", ids),
  ]);
  const profileIds = [...new Set((parts.data ?? []).map((p) => p.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, display_name, avatar_color").in("id", profileIds);
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (calls.data ?? []).map((c) => ({
    ...c,
    participants: (parts.data ?? [])
      .filter((p) => p.call_id === c.id)
      .map((p) => ({
        user_id: p.user_id,
        display_name: pmap.get(p.user_id)?.display_name ?? "Pengguna",
        avatar_color: pmap.get(p.user_id)?.avatar_color ?? "#0ea5e9",
      })),
  }));
}
