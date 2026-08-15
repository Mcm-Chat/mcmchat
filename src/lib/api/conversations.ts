import { supabase } from "@/integrations/supabase/client";

/**
 * Lapisan tipis di atas RPC otorisasi percakapan (Tahap 2B).
 *
 * Klien tidak lagi boleh menulis langsung ke `conversations` maupun
 * `conversation_members`; seluruh perubahan struktur/keanggotaan/preferensi
 * melewati fungsi SECURITY DEFINER yang memvalidasi hubungan kontak, blokir,
 * dan peran grup di server.
 */

const MESSAGES: Record<string, string> = {
  not_connected: "Hubungan kontak tidak aktif",
  blocked: "Kontak diblokir",
  forbidden: "Anda tidak berwenang melakukan tindakan ini",
  last_owner: "Pindahkan kepemilikan grup sebelum keluar",
  invalid_member: "Anggota tidak valid",
  invalid_title: "Nama grup harus 1–80 karakter",
  max_members: "Jumlah anggota melebihi batas",
  direct_invariant: "Aksi ini tidak berlaku untuk percakapan langsung",
};

/** Ubah pesan error Postgres `code: keterangan` menjadi pesan Bahasa Indonesia. */
export function conversationError(raw: string, fallback: string): Error {
  for (const [code, text] of Object.entries(MESSAGES)) {
    if (raw.includes(`${code}:`)) return new Error(text);
  }
  return new Error(fallback);
}

async function rpc<T>(
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>,
  fallback: string,
): Promise<T> {
  const { data, error } = await run();
  if (error) throw conversationError(error.message, fallback);
  return data;
}

/** Buat/pakai ulang percakapan langsung kanonik untuk satu pasangan kontak. */
export async function getOrCreateDirect(otherId: string): Promise<string> {
  const id = await rpc(
    () => supabase.rpc("get_or_create_direct", { _other: otherId }),
    "Gagal membuka percakapan",
  );
  if (!id) throw new Error("Gagal membuka percakapan");
  return id;
}

export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const id = await rpc(
    () => supabase.rpc("create_group", { _title: title, _member_ids: memberIds }),
    "Gagal membuat grup",
  );
  if (!id) throw new Error("Gagal membuat grup");
  return id;
}

export function addGroupMembers(conversationId: string, memberIds: string[]) {
  return rpc(
    () =>
      supabase.rpc("add_group_members", { _conversation: conversationId, _member_ids: memberIds }),
    "Gagal menambahkan anggota",
  );
}

export function removeGroupMember(conversationId: string, targetId: string) {
  return rpc(
    () => supabase.rpc("remove_group_member", { _conversation: conversationId, _target: targetId }),
    "Gagal mengeluarkan anggota",
  );
}

export function setGroupMemberRole(
  conversationId: string,
  targetId: string,
  role: "admin" | "member",
) {
  return rpc(
    () =>
      supabase.rpc("set_group_member_role", {
        _conversation: conversationId,
        _target: targetId,
        _role: role,
      }),
    "Gagal mengubah peran anggota",
  );
}

export function transferGroupOwnership(conversationId: string, targetId: string) {
  return rpc(
    () =>
      supabase.rpc("transfer_group_ownership", {
        _conversation: conversationId,
        _target: targetId,
      }),
    "Gagal memindahkan kepemilikan",
  );
}

export function leaveConversation(conversationId: string) {
  return rpc(
    () => supabase.rpc("leave_conversation", { _conversation: conversationId }),
    "Gagal keluar dari percakapan",
  );
}

export function updateGroupSettings(
  conversationId: string,
  patch: { title?: string; avatarColor?: string; disappearingHours?: number },
) {
  return rpc(
    () =>
      supabase.rpc("update_group_settings", {
        _conversation: conversationId,
        ...(patch.title === undefined ? {} : { _title: patch.title }),
        ...(patch.avatarColor === undefined ? {} : { _avatar_color: patch.avatarColor }),
        ...(patch.disappearingHours === undefined
          ? {}
          : { _disappearing_hours: patch.disappearingHours }),
      }),
    "Gagal menyimpan pengaturan grup",
  );
}

/** Preferensi pribadi saja — peran/identitas keanggotaan tidak dapat disentuh. */
export function updateMyConversationPreferences(
  conversationId: string,
  patch: { muted?: boolean; pinned?: boolean; archived?: boolean },
) {
  return rpc(
    () =>
      supabase.rpc("update_my_conversation_preferences", {
        _conversation: conversationId,
        ...(patch.muted === undefined ? {} : { _muted: patch.muted }),
        ...(patch.pinned === undefined ? {} : { _pinned: patch.pinned }),
        ...(patch.archived === undefined ? {} : { _archived: patch.archived }),
      }),
    "Gagal menyimpan preferensi",
  );
}

export function markConversationRead(conversationId: string, throughMessageId?: string) {
  return rpc(
    () =>
      supabase.rpc("mark_conversation_read", {
        _conversation: conversationId,
        ...(throughMessageId === undefined ? {} : { _through_message_id: throughMessageId }),
      }),
    "Gagal menandai dibaca",
  );
}

export type ConversationCapability = {
  readable: boolean;
  sendable: boolean;
  callable: boolean;
  manageable: boolean;
  role: string | null;
  reason: string;
};

/** Kapabilitas dari server menjadi sumber kebenaran tombol UI. */
export async function fetchConversationCapability(
  conversationId: string,
): Promise<ConversationCapability> {
  const { data } = await supabase.rpc("my_conversation_capability", {
    _conversation: conversationId,
  });
  const row = Array.isArray(data) ? data[0] : null;
  return {
    readable: row?.readable ?? false,
    sendable: row?.sendable ?? false,
    callable: row?.callable ?? false,
    manageable: row?.manageable ?? false,
    role: row?.role ?? null,
    reason: row?.reason ?? "not_member",
  };
}

export function getOrCreateBusinessConversation(businessId: string, customerUserId: string) {
  return rpc(
    () =>
      supabase.rpc("get_or_create_business_conversation", {
        _business: businessId,
        _customer: customerUserId,
      }),
    "Gagal membuka percakapan bisnis",
  );
}

export function setConversationAssignee(conversationId: string, assigneeId: string | null) {
  return rpc(
    () =>
      supabase.rpc("set_conversation_assignee", {
        _conversation: conversationId,
        // Tipe generated menandai argumen wajib; null berarti melepas penugasan.
        _assignee: assigneeId as string,
      }),
    "Gagal menetapkan penanggung jawab",
  );
}

export function setConversationInboxStatus(
  conversationId: string,
  status: "open" | "pending" | "closed",
) {
  return rpc(
    () =>
      supabase.rpc("set_conversation_inbox_status", {
        _conversation: conversationId,
        _status: status,
      }),
    "Gagal mengubah status kotak masuk",
  );
}
