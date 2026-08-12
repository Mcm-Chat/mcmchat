import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type CallRow = Tables<"calls">;
export type CallParticipantRow = Tables<"call_participants">;

/**
 * Adapter panggilan. Media real-time (WebRTC/SFU) belum dikonfigurasi, jadi UI
 * memakai status ini untuk menampilkan info jujur alih-alih pura-pura tersambung.
 * Riwayat, durasi, dan status panggilan tetap tersimpan nyata di database.
 */
export const callProviderConfigured = false;
export const CALL_PROVIDER_NOTICE =
  "Panggilan suara/video real-time belum diaktifkan. Riwayat panggilan tetap tercatat.";

export async function startCall(initiatorId: string, conversationId: string, kind: CallRow["kind"], participantIds: string[]) {
  const call = unwrap(
    await supabase
      .from("calls")
      .insert({ initiator_id: initiatorId, conversation_id: conversationId, kind, status: "ringing", provider: "none" })
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

export async function endCall(callId: string, status: CallRow["status"], durationSec: number) {
  const { error } = await supabase
    .from("calls")
    .update({ status, duration_sec: Math.max(0, Math.round(durationSec)), ended_at: new Date().toISOString() })
    .eq("id", callId);
  if (error) throw new Error(friendly(error.message, "Gagal mengakhiri panggilan"));
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
