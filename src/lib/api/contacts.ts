import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { pinsFor } from "./pins";
import type { Tables } from "@/integrations/supabase/types";

export type ContactRow = Tables<"contacts">;
export type ProfileLite = {
  id: string;
  pin: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  avatar_color: string;
  avatar_version?: number;
};
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

export type PinSearchResult = { found: boolean; code: string; profile: ProfileLite | null };

const SEARCH_ERROR: Record<string, string> = {
  invalid_pin_format: "Format PIN tidak valid. Contoh: A2B3-C4D5",
  rate_limited_cooldown: "Pencarian dijeda sementara. Coba lagi beberapa menit lagi.",
  rate_limited: "Terlalu banyak pencarian. Tunggu sebentar lalu coba lagi.",
  not_authenticated: "Sesi berakhir. Masuk kembali.",
};

export function mapRpcError(
  message: string,
  fallback: string,
  table: Record<string, string>,
): string {
  for (const [code, text] of Object.entries(table)) if (message.includes(code)) return text;
  return friendly(message, fallback);
}

/**
 * Pencarian PIN atomik: normalisasi, validasi format, tolak PIN sendiri,
 * blokir dua arah, rate limit sliding-window, dan pencatatan attempt semuanya
 * dilakukan server dalam satu transaksi. Klien tidak menulis `pin_search_log`.
 */
export async function searchByPin(pin: string): Promise<PinSearchResult> {
  const { data, error } = await supabase.rpc("search_profile_by_pin", { _pin: normalizePin(pin) });
  if (error) throw new Error(mapRpcError(error.message, "Pencarian gagal", SEARCH_ERROR));
  const res = (data ?? {}) as {
    found?: boolean;
    code?: string;
    profile?: Partial<ProfileLite> & { id: string };
  };
  if (res.code === "self_pin") throw new Error("PIN ini milik Anda sendiri.");
  return {
    found: !!res.found,
    code: res.code ?? "not_found",
    profile: res.profile
      ? ({
          bio: "",
          pin: "",
          avatar_url: null,
          avatar_color: "slate",
          display_name: "",
          ...res.profile,
        } as ProfileLite)
      : null,
  };
}

/** Kompatibilitas: kembalikan kartu minimal atau null. */
export async function findByPin(pin: string): Promise<ProfileLite | null> {
  return (await searchByPin(pin)).profile;
}

/**
 * Resolver kartu profil batch (aman). Tidak pernah membocorkan bio/PIN/email;
 * PIN hanya menyusul untuk diri sendiri dan kontak mutual.
 */
async function profilesByIds(ids: string[]): Promise<Map<string, ProfileLite>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const [{ data, error }, pins] = await Promise.all([
    supabase.rpc("profile_cards", { _ids: unique }),
    pinsFor(unique),
  ]);
  if (error) throw new Error(friendly(error.message, "Gagal memuat profil"));
  return new Map(
    (data ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        display_name: p.display_name,
        avatar_color: p.avatar_color,
        avatar_url: p.avatar_url,
        avatar_version: p.avatar_version ?? 0,
        bio: "",
        pin: pins.get(p.id) ?? "",
      } as ProfileLite,
    ]),
  );
}

export async function profileCards(ids: string[]) {
  return profilesByIds(ids);
}

export async function listContacts(userId: string): Promise<ContactWithProfile[]> {
  const rows = unwrap(
    await supabase.from("contacts").select("*").eq("owner_id", userId),
    "Gagal memuat kontak",
  );
  const map = await profilesByIds(rows.map((r) => r.contact_id));
  return rows
    .map((r) => ({ ...r, profile: map.get(r.contact_id) }))
    .filter((r): r is ContactWithProfile => !!r.profile)
    .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));
}

export async function listRequests(
  userId: string,
): Promise<{ incoming: RequestRow[]; outgoing: RequestRow[] }> {
  const rows = unwrap(
    await supabase
      .from("contact_requests")
      .select("*")
      .or(`requester_id.eq.${userId},target_id.eq.${userId}`),
    "Gagal memuat permintaan",
  );
  const map = await profilesByIds(rows.flatMap((r) => [r.requester_id, r.target_id]));
  const decorate = (r: Tables<"contact_requests">, other: string): RequestRow => ({
    ...r,
    profile: map.get(other) ?? null,
  });
  return {
    incoming: rows
      .filter((r) => r.target_id === userId && r.status === "pending")
      .map((r) => decorate(r, r.requester_id)),
    outgoing: rows
      .filter((r) => r.requester_id === userId && r.status === "pending")
      .map((r) => decorate(r, r.target_id)),
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
    await supabase
      .from("contacts")
      .select("is_blocked")
      .eq("owner_id", userId)
      .eq("contact_id", targetId)
      .limit(1),
    "Gagal memeriksa kontak",
  );
  if (blocked[0]?.is_blocked) throw new Error("Kontak ini Anda blokir. Buka blokir dulu.");

  const { error } = await supabase
    .from("contact_requests")
    .upsert(
      { requester_id: userId, target_id: targetId, message, status: "pending" },
      { onConflict: "requester_id,target_id" },
    );
  if (error) throw new Error(friendly(error.message, "Permintaan gagal dikirim"));
}

export async function respondToRequest(
  request: Tables<"contact_requests">,
  action: "accepted" | "rejected" | "blocked",
) {
  // Menerima permintaan harus menulis dua baris kontak (milik penerima dan
  // milik pengirim). Dari sesi penerima, baris milik pengirim ditolak RLS,
  // jadi seluruh proses dijalankan oleh fungsi database tervalidasi.
  const { error } = await supabase.rpc("respond_contact_request", {
    _request: request.id,
    _action: action,
  });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui permintaan"));
}

export async function setBlocked(userId: string, contactId: string, blocked: boolean) {
  const { error } = await supabase
    .from("contacts")
    .upsert(
      { owner_id: userId, contact_id: contactId, is_blocked: blocked },
      { onConflict: "owner_id,contact_id" },
    );
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui blokir"));
}

export type ContactSource = "manual" | "qr_scan" | "request" | "import";

/**
 * Simpan profil hasil pindai ke buku kontak pribadi pemindai.
 * Idempoten: menekan Simpan dua kali tidak membuat baris ganda.
 */
export async function saveContact(
  userId: string,
  contactId: string,
  source: ContactSource = "manual",
  alias?: string | null,
) {
  if (userId === contactId) throw new Error("PIN ini milik Anda sendiri.");
  const { error } = await supabase
    .from("contacts")
    .upsert(
      { owner_id: userId, contact_id: contactId, source, alias: alias ?? null },
      { onConflict: "owner_id,contact_id", ignoreDuplicates: true },
    );
  if (error)
    throw new Error(
      friendly(error.message, "Kontak gagal disimpan. Periksa koneksi lalu coba lagi."),
    );
}

export async function removeContact(userId: string, contactId: string) {
  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("owner_id", userId)
    .eq("contact_id", contactId);
  if (error) throw new Error(friendly(error.message, "Kontak gagal dihapus."));
}

export async function cancelContactRequest(userId: string, targetId: string) {
  const { error } = await supabase
    .from("contact_requests")
    .update({ status: "cancelled" })
    .eq("requester_id", userId)
    .eq("target_id", targetId)
    .eq("status", "pending");
  if (error) throw new Error(friendly(error.message, "Permintaan gagal dibatalkan."));
}

export type ContactRelation = {
  self: boolean;
  saved: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
  outgoingPending: boolean;
  incomingRequest: Tables<"contact_requests"> | null;
};

/** Status relasi antara pemindai dan profil hasil pindai. */
export async function getContactRelation(
  userId: string,
  targetId: string,
): Promise<ContactRelation> {
  if (userId === targetId)
    return {
      self: true,
      saved: false,
      blockedByMe: false,
      blockedMe: false,
      outgoingPending: false,
      incomingRequest: null,
    };
  const [row, requests, blocks] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, is_blocked")
      .eq("owner_id", userId)
      .eq("contact_id", targetId)
      .maybeSingle(),
    supabase
      .from("contact_requests")
      .select("*")
      .eq("status", "pending")
      .or(
        `and(requester_id.eq.${userId},target_id.eq.${targetId}),and(requester_id.eq.${targetId},target_id.eq.${userId})`,
      ),
    isBlockedBetween(userId, targetId),
  ]);
  const pending = requests.data ?? [];
  return {
    self: false,
    saved: !!row.data,
    blockedByMe: !!row.data?.is_blocked,
    blockedMe: blocks.blockedMe,
    outgoingPending: pending.some((r) => r.requester_id === userId),
    incomingRequest: pending.find((r) => r.target_id === userId) ?? null,
  };
}

export async function isBlockedBetween(_userId: string, otherId: string) {
  // Buku kontak lawan bicara tidak boleh dibaca langsung; status blokir dua
  // arah diambil lewat fungsi database yang tervalidasi.
  const { data, error } = await supabase.rpc("blocked_between", { _other: otherId });
  if (error) throw new Error(friendly(error.message, "Gagal memeriksa blokir"));
  const row = data?.[0];
  return { iBlocked: !!row?.i_blocked, blockedMe: !!row?.blocked_me };
}
