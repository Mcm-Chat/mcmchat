import { fetchProfileCards } from "./profiles";
import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";
import { notifyIncomingCall, notifyCallTerminal } from "@/lib/push/push.functions";
import { getCallConfig } from "@/lib/calls/calls.functions";
import type { EndReason } from "@/lib/calls/policy";

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

/** Sisa waktu dering dihitung absolut dari `created_at`, bukan dari saat layar dibuka. */
export function ringRemainingMs(createdAt: string, now = Date.now()): number {
  const started = new Date(createdAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, started + RING_TIMEOUT_MS - now);
}

export const CALL_UNCONFIGURED_MESSAGE =
  "Panggilan belum aktif: kredensial penyedia panggilan belum diisi. Minta pemilik aplikasi mengisi LIVEKIT_URL, LIVEKIT_API_KEY, dan LIVEKIT_API_SECRET.";

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
  // Preflight: tanpa penyedia yang siap, jangan membuat baris `ringing` hantu
  // dan jangan mengganggu penerima dengan notifikasi.
  const cfg = await getCallConfig().catch(() => ({ configured: false }));
  if (!cfg.configured) throw new Error(CALL_UNCONFIGURED_MESSAGE);
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
  reason?: EndReason,
) {
  const { error } = await supabase.rpc("end_call", {
    _call: callId,
    _status: status,
    _duration: Math.max(0, Math.round(durationSec)),
    ...(reason ? { _reason: reason } : {}),
  });
  if (error) throw new Error(friendly(error.message, "Gagal mengakhiri panggilan"));
  // Best-effort: batalkan notifikasi panggilan basi di perangkat peserta lain.
  void notifyCallTerminal({ data: { callId } }).catch(() => undefined);
}

/**
 * Penerima menjawab lewat compare-and-set di server sehingga tap ganda,
 * pemanggil yang mencoba menjawab sendiri, atau panggilan yang sudah berakhir
 * tidak pernah menghasilkan state ganda.
 */
export async function answerCall(callId: string) {
  const { data, error } = await supabase.rpc("answer_call", { _call: callId });
  if (error) throw new Error(friendly(error.message, "Gagal menjawab panggilan"));
  void notifyCallTerminal({ data: { callId } }).catch(() => undefined);
  return data as unknown as CallRow;
}

export async function declineCall(callId: string) {
  // Jalur khusus penolakan: pada grup hanya penerima ini yang keluar, panggilan
  // baru berstatus `declined` saat penerima terakhir menolak.
  const { error } = await supabase.rpc("decline_call", { _call: callId });
  if (error) throw new Error(friendly(error.message, "Gagal menolak panggilan"));
  void notifyCallTerminal({ data: { callId } }).catch(() => undefined);
}

/**
 * Bergabung ke room (idempotent). Peserta yang sudah keluar/menolak tidak
 * pernah dihidupkan kembali oleh server.
 */
export async function joinCall(callId: string) {
  const { data, error } = await supabase.rpc("join_call", { _call: callId });
  if (error) throw new Error(friendly(error.message, "Gagal bergabung ke panggilan"));
  return data as unknown as CallRow;
}

/**
 * Keluar dari panggilan. Server yang memutuskan apakah panggilan ikut berakhir:
 * 1:1 dan pemanggil grup mengakhiri, peserta grup biasa hanya keluar.
 */
export async function leaveCall(callId: string, durationSec = 0) {
  const { data, error } = await supabase.rpc("leave_call", {
    _call: callId,
    _duration: Math.max(0, Math.round(durationSec)),
  });
  if (error) throw new Error(friendly(error.message, "Gagal keluar dari panggilan"));
  void notifyCallTerminal({ data: { callId } }).catch(() => undefined);
  return data as unknown as CallRow;
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
  // Sumber kebenaran ada di server: hanya panggilan yang keanggotaan saya
  // masih aktif (`left_at IS NULL`) yang boleh memunculkan banner lagi.
  const { data: mine } = await supabase
    .from("call_participants")
    .select("call_id")
    .eq("user_id", userId)
    .is("left_at", null);
  const ids = (mine ?? []).map((m) => m.call_id);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("calls")
    .select("*")
    .in("id", ids)
    .eq("status", "ringing")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data ?? []).filter((c) => c.initiator_id !== userId);
}

/**
 * Apakah pengguna masih penerima aktif panggilan ini? Dipakai sebelum
 * memunculkan banner panggilan masuk agar penolak grup tidak melihatnya lagi.
 */
export async function isActiveRecipient(callId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("call_participants")
    .select("left_at")
    .eq("call_id", callId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data) && data?.left_at == null;
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
      if (row.status !== "ringing" || row.initiator_id === userId) return;
      // Verifikasi ke server, bukan sekadar state lokal.
      void isActiveRecipient(row.id, userId).then((ok) => {
        if (ok) onIncoming(row);
      });
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
  const pmap = await fetchProfileCards(profileIds);
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
