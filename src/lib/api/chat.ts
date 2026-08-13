import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { ApiError, classifyFailure } from "./errors";
import { notifyNewMessage } from "@/lib/push/push.functions";
import { removeObject, uploadChatMedia } from "./storage";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type MessageRow = Tables<"messages">;
export type ConversationRow = Tables<"conversations">;
export type MemberProfile = {
  id: string;
  display_name: string;
  pin: string;
  avatar_color: string;
  avatar_url: string | null;
  avatar_version?: number;
};

/** Ringkasan per percakapan dari RPC `conversation_overview`. */
type OverviewRow = {
  conversation_id: string;
  last_message_id: string | null;
  last_message_kind: MessageRow["kind"] | null;
  last_message_body: string | null;
  last_message_sender: string | null;
  last_message_at: string | null;
  last_attachment_name: string | null;
  last_location_lat: number | null;
  unread_count: number;
};

/**
 * Ringkasan pesan terakhir untuk daftar percakapan. Bentuknya sengaja
 * menyerupai `messages` agar komponen daftar tidak perlu berubah, tetapi hanya
 * berisi kolom yang benar-benar dipakai untuk pratinjau.
 */
export type LastMessagePreview = Pick<
  MessageRow,
  "id" | "kind" | "body" | "sender_id" | "created_at" | "attachment_name" | "location_lat"
>;

export type ConversationView = ConversationRow & {
  members: MemberProfile[];
  me: Tables<"conversation_members">;
  other: MemberProfile | null;
  lastMessage: LastMessagePreview | null;
  unread: number;
  title_resolved: string;
};

export type MessageLocationInput = {
  lat: number;
  lng: number;
  accuracy: number;
  label: string;
  mapsUrl: string;
};

export function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Ringkasan pesan untuk daftar percakapan. */
export function previewOf(m: LastMessagePreview | MessageRow | null): string {
  if (!m) return "Belum ada pesan";
  const loc = m.location_lat != null ? " • 📍 lokasi" : "";
  switch (m.kind) {
    case "image":
      return `📷 Foto${m.body ? ` • ${m.body}` : ""}${loc}`;
    case "document":
      return `📎 ${m.attachment_name ?? "Dokumen"}`;
    case "voice":
      return "🎙️ Pesan suara";
    case "sales_card":
      return "🧾 Rincian penjualan";
    case "product_card":
      return `🛍️ ${m.body || "Kartu produk"}`;
    case "ledger":
      return "💰 Catatan utang/piutang";
    default:
      return m.body || "Pesan";
  }
}

export async function listConversations(userId: string): Promise<ConversationView[]> {
  const memberships = unwrap(
    await supabase.from("conversation_members").select("*").eq("user_id", userId),
    "Gagal memuat percakapan",
  );
  if (memberships.length === 0) return [];
  const ids = memberships.map((m) => m.conversation_id);
  // Pesan terakhir + jumlah belum dibaca dihitung di database (satu baris per
  // percakapan), bukan dengan menarik ratusan pesan ke browser.
  const [convs, allMembers, overview] = await Promise.all([
    supabase.from("conversations").select("*").in("id", ids),
    supabase
      .from("conversation_members")
      .select("conversation_id, user_id")
      .in("conversation_id", ids),
    supabase.rpc("conversation_overview"),
  ]);
  const profileIds = [...new Set((allMembers.data ?? []).map((m) => m.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_color, avatar_url, avatar_version")
    .in("id", profileIds.length ? profileIds : ["00000000-0000-0000-0000-000000000000"]);
  const pmap = new Map((profiles ?? []).map((p) => [p.id, { ...p, pin: "" } as MemberProfile]));
  const omap = new Map(((overview.data ?? []) as OverviewRow[]).map((o) => [o.conversation_id, o]));

  return (convs.data ?? [])
    .map((c) => {
      const me = memberships.find((m) => m.conversation_id === c.id)!;
      const members = (allMembers.data ?? [])
        .filter((m) => m.conversation_id === c.id)
        .map((m) => pmap.get(m.user_id))
        .filter((p): p is MemberProfile => !!p);
      const other = c.type === "direct" ? (members.find((m) => m.id !== userId) ?? null) : null;
      const o = omap.get(c.id);
      const lastMessage: LastMessagePreview | null =
        o && o.last_message_id && o.last_message_at
          ? {
              id: o.last_message_id,
              kind: o.last_message_kind ?? "text",
              body: o.last_message_body ?? "",
              sender_id: o.last_message_sender ?? "",
              created_at: o.last_message_at,
              attachment_name: o.last_attachment_name,
              location_lat: o.last_location_lat,
            }
          : null;
      return {
        ...c,
        me,
        members,
        other,
        lastMessage,
        unread: o?.unread_count ?? 0,
        title_resolved: c.title || other?.display_name || "Percakapan",
      };
    })
    .sort((a, b) => {
      if (a.me.is_pinned !== b.me.is_pinned) return a.me.is_pinned ? -1 : 1;
      return (
        new Date(b.lastMessage?.created_at ?? b.last_message_at).getTime() -
        new Date(a.lastMessage?.created_at ?? a.last_message_at).getTime()
      );
    });
}

/** Cari percakapan langsung dengan kontak, buat kalau belum ada. */
export async function getOrCreateDirect(userId: string, otherId: string): Promise<string> {
  const mine = unwrap(
    await supabase.from("conversation_members").select("conversation_id").eq("user_id", userId),
    "Gagal memuat percakapan",
  );
  if (mine.length > 0) {
    const theirs = unwrap(
      await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", otherId)
        .in(
          "conversation_id",
          mine.map((m) => m.conversation_id),
        ),
      "Gagal memuat percakapan",
    );
    if (theirs.length > 0) {
      const { data: direct } = await supabase
        .from("conversations")
        .select("id")
        .eq("type", "direct")
        .in(
          "id",
          theirs.map((t) => t.conversation_id),
        )
        .limit(1);
      if (direct?.[0]) return direct[0].id;
    }
  }
  const conv = unwrap(
    await supabase
      .from("conversations")
      .insert({ type: "direct", created_by: userId })
      .select("id")
      .single(),
    "Gagal membuat percakapan",
  );
  const { error } = await supabase.from("conversation_members").insert([
    { conversation_id: conv.id, user_id: userId },
    { conversation_id: conv.id, user_id: otherId },
  ]);
  if (error) throw new Error(friendly(error.message, "Gagal menambahkan anggota percakapan"));
  return conv.id;
}

export async function createGroup(
  userId: string,
  title: string,
  memberIds: string[],
): Promise<string> {
  const conv = unwrap(
    await supabase
      .from("conversations")
      .insert({ type: "group", title, created_by: userId })
      .select("id")
      .single(),
    "Gagal membuat grup",
  );
  await supabase.from("conversation_members").insert(
    [userId, ...memberIds].map((id) => ({
      conversation_id: conv.id,
      user_id: id,
      role: id === userId ? "admin" : "member",
    })),
  );
  return conv.id;
}

export const MESSAGE_PAGE_SIZE = 40;

/** Kursor keyset stabil: dua pesan dengan `created_at` sama dibedakan oleh id. */
export type MessageCursor = { createdAt: string; id: string };

export function cursorOf(m: MessageRow): MessageCursor {
  return { createdAt: m.created_at, id: m.id };
}

/** Urutan stabil: server timestamp, lalu id sebagai tie-breaker deterministik. */
export function compareMessages(a: MessageRow, b: MessageRow): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Satu halaman pesan (terbaru lebih dulu di server, dikembalikan menaik).
 * Kursor `before` memakai pasangan `(created_at, id)` sehingga pesan dengan
 * timestamp identik tidak pernah terlewat saat memuat halaman lama.
 */
export async function listMessages(
  conversationId: string,
  userId: string,
  opts: { before?: MessageCursor | null; limit?: number } = {},
): Promise<MessageRow[]> {
  const limit = opts.limit ?? MESSAGE_PAGE_SIZE;
  let q = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (opts.before) {
    const { createdAt, id } = opts.before;
    q = q.or(`created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`);
  }
  const [msgs, hides] = await Promise.all([
    q,
    supabase.from("message_hides").select("message_id").eq("user_id", userId),
  ]);
  if (msgs.error) throw new Error(friendly(msgs.error.message, "Gagal memuat pesan"));
  const hidden = new Set((hides.data ?? []).map((h) => h.message_id));
  return (msgs.data ?? []).filter((m) => !hidden.has(m.id)).sort(compareMessages);
}

export type SendMessageInput = {
  conversationId: string;
  senderId: string;
  kind?: MessageRow["kind"];
  body?: string;
  replyToId?: string | null;
  file?: { blob: Blob; name: string } | null;
  location?: MessageLocationInput | null;
  payload?: Record<string, unknown> | null;
  durationSec?: number | null;
  /** Kunci idempotensi buatan perangkat; mencegah duplikasi saat retry/reconnect. */
  clientId?: string | null;
};

export async function sendMessage(input: SendMessageInput): Promise<MessageRow> {
  const row: TablesInsert<"messages"> = {
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    kind: input.kind ?? "text",
    body: input.body ?? "",
    reply_to_id: input.replyToId ?? null,
    payload: (input.payload ?? null) as never,
    duration_sec: input.durationSec ?? null,
    client_id: input.clientId ?? null,
  };
  if (input.file) {
    const up = await uploadChatMedia(input.conversationId, input.file.blob, input.file.name);
    row.attachment_path = up.path;
    row.attachment_name = up.name;
    row.attachment_mime = up.mime;
    row.attachment_size = up.size;
  }
  if (input.location) {
    row.location_lat = input.location.lat;
    row.location_lng = input.location.lng;
    row.location_accuracy = input.location.accuracy;
    row.location_label = input.location.label;
    row.location_maps_url = input.location.mapsUrl;
  }
  const { data, error } = await supabase.from("messages").insert(row).select("*").single();
  if (error) {
    // Duplikat berarti percobaan sebelumnya sudah tersimpan di server: ambil
    // baris aslinya dan perlakukan sebagai sukses (idempotent).
    if (classifyFailure(error) === "duplicate" && input.clientId) {
      const existing = await findByClientId(input.conversationId, input.senderId, input.clientId);
      if (existing) return existing;
    }
    throw new ApiError(friendly(error.message, "Pesan gagal dikirim"), error);
  }
  // Fan-out push ke perangkat penerima (mute + preferensi dihormati di server).
  // Sengaja tidak di-await: kegagalan push tidak boleh menggagalkan kirim pesan.
  void notifyNewMessage({ data: { messageId: data.id } }).catch(() => undefined);
  return data;
}

/** Cari pesan yang sudah tersimpan untuk sebuah kunci idempotensi. */
export async function findByClientId(
  conversationId: string,
  senderId: string,
  clientId: string,
): Promise<MessageRow | null> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("sender_id", senderId)
    .eq("client_id", clientId)
    .maybeSingle();
  return data ?? null;
}

export async function markRead(conversationId: string, userId: string) {
  await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

/** Sembunyikan pesan hanya untuk saya. */
export async function deleteForMe(messageIds: string[], userId: string) {
  const { error } = await supabase
    .from("message_hides")
    .insert(messageIds.map((id) => ({ message_id: id, user_id: userId })));
  if (error && !error.message.includes("duplicate"))
    throw new Error(friendly(error.message, "Gagal menghapus pesan"));
}

/**
 * Hapus permanen untuk semua peserta: baris pesan + berkas lampiran dihapus,
 * sehingga tidak ada tombstone/placeholder yang tersisa di UI mana pun.
 * Reaksi, tanda terima, dan penanda "hapus untuk saya" ikut terhapus via cascade,
 * dan referensi balasan otomatis menjadi kosong.
 */
export async function deleteForEveryone(messages: MessageRow[], userId: string) {
  const mine = messages.filter((m) => m.sender_id === userId);
  if (mine.length === 0) return;
  for (const m of mine) if (m.attachment_path) await removeObject("chat-media", m.attachment_path);
  const { error } = await supabase
    .from("messages")
    .delete()
    .in(
      "id",
      mine.map((m) => m.id),
    );
  if (error) throw new Error(friendly(error.message, "Gagal menghapus pesan"));
}

export async function toggleReaction(messageId: string, userId: string, emoji: string) {
  const existing = unwrap(
    await supabase
      .from("message_reactions")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji),
    "Gagal memuat reaksi",
  );
  if (existing.length > 0)
    await supabase.from("message_reactions").delete().eq("id", existing[0]!.id);
  else
    await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, user_id: userId, emoji });
}

export async function editMessage(messageId: string, body: string) {
  const { error } = await supabase
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) throw new Error(friendly(error.message, "Gagal mengubah pesan"));
}
