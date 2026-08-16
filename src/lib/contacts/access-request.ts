/**
 * Prefill formulir "Minta akses ke kontak".
 *
 * CTA pada modal penolakan push membawa id percakapan. Dari id itu kita coba
 * menemukan lawan bicara pada percakapan langsung, lalu mengisi formulir
 * permintaan kontak otomatis sehingga pengguna tinggal menekan "Kirim".
 * Bila identitas tidak bisa dibaca (mis. grup atau baris tertutup RLS),
 * formulir tetap terbuka dengan pesan siap pakai dan PIN diisi manual.
 */
import { supabase } from "@/integrations/supabase/client";
import { profileCards, type ProfileLite } from "@/lib/api/contacts";

export type AccessRequestPrefill = {
  profile: ProfileLite | null;
  message: string;
};

const REASON_MESSAGE: Record<string, string> = {
  removed: "Halo, saya dikeluarkan dari percakapan kita. Boleh terhubung kembali di MCM?",
  not_member: "Halo, saya ingin bergabung kembali ke percakapan kita di MCM.",
  blocked: "Halo, saya ingin membuka kembali komunikasi kita di MCM.",
};

export function accessRequestMessage(reason?: string | undefined, name?: string | undefined) {
  const base = REASON_MESSAGE[reason ?? ""] ?? "Halo, saya ingin terhubung di MCM.";
  return name ? `Halo ${name}, ${base.replace(/^Halo, /, "")}` : base;
}

/** Cari profil lawan bicara dari percakapan langsung; null bila tidak terbaca. */
export async function resolveAccessTarget(
  conversationId: string,
  selfId: string,
): Promise<ProfileLite | null> {
  const { data } = await supabase
    .from("direct_conversations")
    .select("user_low,user_high")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!data) return null;
  const peer = data.user_low === selfId ? data.user_high : data.user_low;
  if (!peer || peer === selfId) return null;
  const cards = await profileCards([peer]).catch(() => new Map<string, ProfileLite>());
  return cards.get(peer) ?? null;
}

export async function buildAccessPrefill(
  conversationId: string,
  selfId: string,
  reason?: string | undefined,
): Promise<AccessRequestPrefill> {
  const profile = await resolveAccessTarget(conversationId, selfId).catch(() => null);
  return { profile, message: accessRequestMessage(reason, profile?.display_name) };
}
