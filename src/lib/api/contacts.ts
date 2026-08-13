import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { pinsFor } from "./pins";
import type { Tables } from "@/integrations/supabase/types";

export type ContactRow = Tables<"contacts">;
export type ProfileLite = { id: string; pin: string; display_name: string; bio: string; avatar_url: string | null; avatar_color: string; avatar_version?: number };
export type ContactWithProfile = ContactRow & { profile: ProfileLite };
export type RequestRow = Tables<"contact_requests"> & { profile: ProfileLite | null };

export const PIN_PATTERN = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

export function normalizePin(input: string) {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw;
}

export function isValidPin(input: string) {
  return PIN_PATTERN.test(normalizePin(input));
}

export async function findByPin(pin: string): Promise<ProfileLite | null> {
  const normalized = normalizePin(pin);
  if (!isValidPin(normalized)) throw new Error("Format PIN tidak valid. Contoh: A2B3-C4D5");
  await supabase.from("pin_search_log").insert({ user_id: (await supabase.auth.getUser()).data.user?.id ?? "", pin: normalized });
  const { data, error } = await supabase.rpc("find_profile_by_pin", { _pin: normalized });
  if (error) throw new Error(friendly(error.message, "Pencarian gagal"));
  return (data?.[0] as ProfileLite | undefined) ?? null;
}

async function profilesByIds(ids: string[]): Promise<Map<string, ProfileLite>> {
  if (ids.length === 0) return new Map();
  // PIN diambil terpisah: hanya kontak tersimpan (dan diri sendiri) yang boleh terlihat.
  const [{ data }, pins] = await Promise.all([
    supabase.from("profiles").select("id, display_name, bio, avatar_url, avatar_color, avatar_version").in("id", ids),
    pinsFor(ids),
  ]);
  return new Map((data ?? []).map((p) => [p.id, { ...p, pin: pins.get(p.id) ?? "" } as ProfileLite]));
}

export async function listContacts(userId: string): Promise<ContactWithProfile[]> {
  const rows = unwrap(await supabase.from("contacts").select("*").eq("owner_id", userId), "Gagal memuat kontak");
  const map = await profilesByIds(rows.map((r) => r.contact_id));
  return rows
    .map((r) => ({ ...r, profile: map.get(r.contact_id) }))
    .filter((r): r is ContactWithProfile => !!r.profile)
    .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));
}

export async function listRequests(userId: string): Promise<{ incoming: RequestRow[]; outgoing: RequestRow[] }> {
  const rows = unwrap(
    await supabase.from("contact_requests").select("*").or(`requester_id.eq.${userId},target_id.eq.${userId}`),
    "Gagal memuat permintaan",
  );
  const map = await profilesByIds(rows.flatMap((r) => [r.requester_id, r.target_id]));
  const decorate = (r: Tables<"contact_requests">, other: string): RequestRow => ({ ...r, profile: map.get(other) ?? null });
  return {
    incoming: rows.filter((r) => r.target_id === userId && r.status === "pending").map((r) => decorate(r, r.requester_id)),
    outgoing: rows.filter((r) => r.requester_id === userId && r.status === "pending").map((r) => decorate(r, r.target_id)),
  };
}

export async function sendContactRequest(userId: string, targetId: string, message: string) {
  const recent = unwrap(
    await supabase
      .from("contact_requests")
      .select("id, created_at")
      .eq("requester_id", userId)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString()),
    "Gagal memeriksa permintaan",
  );
  if (recent.length >= 5) throw new Error("Terlalu banyak permintaan kontak. Tunggu sebentar.");

  const blocked = unwrap(
    await supabase.from("contacts").select("is_blocked").eq("owner_id", userId).eq("contact_id", targetId).limit(1),
    "Gagal memeriksa kontak",
  );
  if (blocked[0]?.is_blocked) throw new Error("Kontak ini Anda blokir. Buka blokir dulu.");

  const { error } = await supabase
    .from("contact_requests")
    .upsert({ requester_id: userId, target_id: targetId, message, status: "pending" }, { onConflict: "requester_id,target_id" });
  if (error) throw new Error(friendly(error.message, "Permintaan gagal dikirim"));
}

export async function respondToRequest(request: Tables<"contact_requests">, action: "accepted" | "rejected" | "blocked") {
  // Menerima permintaan harus menulis dua baris kontak (milik penerima dan
  // milik pengirim). Dari sesi penerima, baris milik pengirim ditolak RLS,
  // jadi seluruh proses dijalankan oleh fungsi database tervalidasi.
  const { error } = await supabase.rpc("respond_contact_request", { _request: request.id, _action: action });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui permintaan"));
}

export async function setBlocked(userId: string, contactId: string, blocked: boolean) {
  const { error } = await supabase
    .from("contacts")
    .upsert({ owner_id: userId, contact_id: contactId, is_blocked: blocked }, { onConflict: "owner_id,contact_id" });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui blokir"));
}

export async function isBlockedBetween(_userId: string, otherId: string) {
  // Buku kontak lawan bicara tidak boleh dibaca langsung; status blokir dua
  // arah diambil lewat fungsi database yang tervalidasi.
  const { data, error } = await supabase.rpc("blocked_between", { _other: otherId });
  if (error) throw new Error(friendly(error.message, "Gagal memeriksa blokir"));
  const row = data?.[0];
  return { iBlocked: !!row?.i_blocked, blockedMe: !!row?.blocked_me };
}
