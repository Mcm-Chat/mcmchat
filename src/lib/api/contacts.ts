import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { pinsFor } from "./pins";
import { notifyContactRequest } from "@/lib/push/push.functions";
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
export type ContactWithProfile = ContactRow & {
  profile: ProfileLite;
  /** true bila hubungan sudah diterima kedua sisi (bukan sekadar disimpan). */
  connected: boolean;
};
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
  const [map, { data: connectedRows }] = await Promise.all([
    profilesByIds(rows.map((r) => r.contact_id)),
    supabase.rpc("my_connected_contacts"),
  ]);
  const connected = new Set((connectedRows ?? []).map((c) => c.contact_id));
  return rows
    .map((r) => ({ ...r, profile: map.get(r.contact_id), connected: connected.has(r.contact_id) }))
    .filter((r): r is ContactWithProfile => !!r.profile)
    .sort((a, b) => a.profile.display_name.localeCompare(b.profile.display_name));
}

/**
 * Label status permintaan kontak untuk ditampilkan apa adanya di UI.
 *
 * `accepted` yang terjadi <60 detik setelah dibuat berarti permintaan itu
 * langsung diterima (kedua sisi saling menambahkan), bukan lewat tombol.
 */
export function requestStatusLabel(
  r: Tables<"contact_requests">,
  direction: "incoming" | "outgoing",
): { label: string; tone: "warning" | "success" | "danger" | "neutral" } {
  switch (r.status) {
    case "pending":
      return direction === "incoming"
        ? { label: "Menunggu jawaban Anda", tone: "warning" }
        : { label: "Terkirim · menunggu", tone: "warning" };
    case "accepted": {
      const gap = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime();
      return {
        label: gap >= 0 && gap < 60_000 ? "Langsung diterima" : "Diterima",
        tone: "success",
      };
    }
    case "rejected":
      return { label: "Ditolak", tone: "danger" };
    case "blocked":
      return { label: "Diblokir", tone: "danger" };
    case "cancelled":
      return { label: "Dibatalkan", tone: "neutral" };
    default:
      return { label: String(r.status), tone: "neutral" };
  }
}

/** Riwayat permintaan yang sudah selesai tetap ditampilkan selama 7 hari. */
const REQUEST_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

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
  const cutoff = Date.now() - REQUEST_HISTORY_MS;
  // Pending selalu tampil; yang sudah direspons tampil sebagai riwayat singkat
  // supaya statusnya (diterima/ditolak/dibatalkan) terlihat, bukan hilang diam.
  const visible = (r: Tables<"contact_requests">) =>
    r.status === "pending" || new Date(r.updated_at).getTime() >= cutoff;
  const byRecency = (a: Tables<"contact_requests">, b: Tables<"contact_requests">) =>
    (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) ||
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  return {
    incoming: rows
      .filter((r) => r.target_id === userId && visible(r))
      .sort(byRecency)
      .map((r) => decorate(r, r.requester_id)),
    outgoing: rows
      .filter((r) => r.requester_id === userId && visible(r))
      .sort(byRecency)
      .map((r) => decorate(r, r.target_id)),
  };
}

const REQUEST_ERROR: Record<string, string> = {
  already_connected: "Kalian sudah terhubung sebagai kontak.",
  blocked: "Permintaan tidak dapat dikirim ke akun ini.",
  cooldown: "Permintaan baru saja ditolak/dibatalkan. Tunggu 10 menit sebelum mengirim ulang.",
  rate_limited: "Terlalu banyak permintaan kontak. Tunggu sebentar.",
  invalid_target: "Akun tujuan tidak valid.",
  not_authenticated: "Sesi berakhir. Masuk kembali.",
};

/**
 * Terima permintaan masuk yang masih menunggu dari `otherId` (jika ada).
 * Dipakai saat kedua sisi saling menambahkan: alih-alih gagal/senyap,
 * permintaan lawan langsung diterima sehingga kontak benar-benar terhubung.
 */
async function acceptIncomingFrom(otherId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("contact_requests")
    .select("id")
    .eq("requester_id", otherId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  const { error: rpcError } = await supabase.rpc("respond_contact_request", {
    _request: data.id,
    _action: "accepted",
  });
  return !rpcError;
}

/** Kirim permintaan kontak lewat RPC atomik (anti-duplikat + cooldown). */
export async function sendContactRequest(
  _userId: string,
  targetId: string,
  message: string,
): Promise<{ status?: string; code?: string }> {
  const { data, error } = await supabase.rpc("send_contact_request", {
    _target: targetId,
    _message: message,
  });
  if (error) throw new Error(mapRpcError(error.message, "Permintaan gagal dikirim", REQUEST_ERROR));
  const result = (data ?? {}) as { status?: string; code?: string };
  // Lawan sudah lebih dulu mengirim permintaan: terima langsung agar kontak
  // tersimpan, bukan berhenti diam-diam tanpa perubahan apa pun.
  if (result.code === "incoming_pending" && (await acceptIncomingFrom(targetId))) {
    return { status: "accepted", code: "accepted_incoming" };
  }
  // Permintaan benar-benar baru/terkirim ulang → beri tahu target lewat push
  // (best-effort; kegagalan push tidak boleh menggagalkan permintaan).
  if (result.code === "sent" || result.code === "resent") {
    void pushContactRequest(targetId);
  }
  return result;
}

/**
 * Kirim push "permintaan kontak baru" ke target. Server memverifikasi ulang
 * kepemilikan permintaan; klien hanya menyerahkan id-nya.
 */
async function pushContactRequest(targetId: string) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const me = auth.user?.id;
    if (!me) return;
    const { data: row } = await supabase
      .from("contact_requests")
      .select("id")
      .eq("requester_id", me)
      .eq("target_id", targetId)
      .eq("status", "pending")
      .maybeSingle();
    if (!row?.id) return;
    await notifyContactRequest({ data: { requestId: row.id } });
  } catch {
    /* push bersifat tambahan; permintaan kontak tetap tersimpan */
  }
}

export async function respondToRequest(
  request: Tables<"contact_requests">,
  action: "accepted" | "rejected" | "blocked",
) {
  // Hanya target yang boleh merespons; accept menulis dua baris kontak mutual
  // secara atomik di server.
  const { error } = await supabase.rpc("respond_contact_request", {
    _request: request.id,
    _action: action,
  });
  if (error)
    throw new Error(
      mapRpcError(error.message, "Gagal memperbarui permintaan", {
        not_authorized: "Anda tidak berwenang menjawab permintaan ini.",
        request_not_pending: "Permintaan ini sudah tidak aktif.",
        request_not_found: "Permintaan tidak ditemukan.",
      }),
    );
}

/** Blokir/buka blokir atomik: membatalkan permintaan tertunda dua arah. */
export async function setBlocked(_userId: string, contactId: string, blocked: boolean) {
  const { error } = await supabase.rpc("set_contact_blocked", {
    _target: contactId,
    _blocked: blocked,
  });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui blokir"));
}

export type ContactSource = "manual" | "qr" | "pin";

/**
 * Simpan kartu profil ke buku kontak pribadi (SATU ARAH).
 * Menyimpan bukan berarti terhubung: hak chat/panggilan/profil lengkap baru
 * terbuka setelah permintaan diterima kedua sisi.
 */
export async function saveContact(
  userId: string,
  contactId: string,
  source: ContactSource = "manual",
  alias?: string | null,
) {
  if (userId === contactId) throw new Error("PIN ini milik Anda sendiri.");
  const { error } = await supabase.rpc("save_contact_card", {
    _target: contactId,
    _source: source,
    ...(alias == null ? {} : { _alias: alias }),
  });
  if (error)
    throw new Error(
      mapRpcError(error.message, "Kontak gagal disimpan. Periksa koneksi lalu coba lagi.", {
        blocked: "Kontak ini tidak dapat disimpan.",
        invalid_target: "Akun tujuan tidak valid.",
      }),
    );
}

export async function updateMyContact(
  contactId: string,
  patch: { alias?: string | null; note?: string | null; starred?: boolean; isFavorite?: boolean },
) {
  const { error } = await supabase.rpc("update_my_contact", {
    _target: contactId,
    ...(patch.alias == null ? {} : { _alias: patch.alias }),
    ...(patch.note == null ? {} : { _note: patch.note }),
    ...(patch.starred == null ? {} : { _starred: patch.starred }),
    ...(patch.isFavorite == null ? {} : { _is_favorite: patch.isFavorite }),
  });
  if (error) throw new Error(friendly(error.message, "Gagal memperbarui kontak."));
}

/**
 * Hapus KARTU tersimpan. Hanya boleh untuk kontak yang belum punya hubungan
 * aktif; hubungan yang sudah diterima harus diputus lewat `disconnectContact`.
 */
export async function removeSavedContact(_userId: string, contactId: string) {
  const { error } = await supabase.rpc("remove_saved_contact", { _target: contactId });
  if (error)
    throw new Error(
      mapRpcError(error.message, "Kontak gagal dihapus.", {
        connected_requires_disconnect: "Kalian masih terhubung. Putuskan hubungan terlebih dahulu.",
        invalid_target: "Akun tujuan tidak valid.",
      }),
    );
}

/** Putuskan hubungan yang sudah diterima (menonaktifkan koneksi, menjaga audit). */
export async function disconnectContact(_userId: string, contactId: string) {
  const { error } = await supabase.rpc("disconnect_contact", { _target: contactId });
  if (error) throw new Error(friendly(error.message, "Gagal memutus hubungan."));
}

export async function cancelContactRequest(_userId: string, targetId: string) {
  const { error } = await supabase.rpc("cancel_contact_request", { _target: targetId });
  if (error) throw new Error(friendly(error.message, "Permintaan gagal dibatalkan."));
}

export type ContactRelation = {
  self: boolean;
  /** Tersimpan satu arah di buku kontak saya (belum tentu terhubung). */
  saved: boolean;
  /** Kontak mutual yang sudah diterima kedua sisi. */
  connected: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
  outgoingPending: boolean;
  incomingRequest: Tables<"contact_requests"> | null;
};

/** Status relasi antara pemindai dan profil hasil pindai (satu RPC). */
export async function getContactRelation(
  _userId: string,
  targetId: string,
): Promise<ContactRelation> {
  const { data, error } = await supabase.rpc("contact_relation", { _other: targetId });
  if (error) throw new Error(friendly(error.message, "Gagal memeriksa relasi"));
  const r = (data ?? {}) as Record<string, unknown>;
  let incoming: Tables<"contact_requests"> | null = null;
  const incomingId = r["incoming_request_id"] as string | null;
  if (incomingId) {
    const { data: req } = await supabase
      .from("contact_requests")
      .select("*")
      .eq("id", incomingId)
      .maybeSingle();
    incoming = req ?? null;
  }
  return {
    self: !!r["self"],
    saved: !!r["saved"],
    connected: !!r["connected"],
    blockedByMe: !!r["blocked_by_me"],
    blockedMe: !!r["blocked_me"],
    outgoingPending: !!r["outgoing_pending"],
    incomingRequest: incoming,
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
