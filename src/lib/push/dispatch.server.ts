/** Logika fan-out push (server-only). Tidak pernah diimpor klien. */
import { CHANNELS, notificationTitle, previewBody, type NotifCategory, type PushData, type PushKind } from "./payload";
import { sendPush, pushConfigured, type FcmResult, type PushTarget } from "./fcm.server";

type Row = Record<string, unknown>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Bersihkan token yang ditolak FCM agar tidak dipakai lagi. */
async function pruneTokens(tokens: string[]) {
  if (tokens.length === 0) return;
  const db = await admin();
  await db.from("devices").update({ push_token: null, revoked_at: new Date().toISOString() }).in("push_token", tokens);
}

/** Push pesan chat baru ke seluruh anggota lain (mute + preferensi dihormati). */
export async function dispatchMessagePush(messageId: string): Promise<FcmResult> {
  if (!pushConfigured()) {
    return { configured: false, sent: 0, failed: 0, invalidTokens: [], reason: "FCM belum terhubung" };
  }
  const db = await admin();

  const { data: msg } = await db
    .from("messages")
    .select("id, conversation_id, sender_id, kind, body")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return { configured: true, sent: 0, failed: 0, invalidTokens: [], reason: "pesan tidak ditemukan" };

  const [{ data: conv }, { data: sender }] = await Promise.all([
    db.from("conversations").select("id, type, title").eq("id", msg.conversation_id).maybeSingle(),
    db.from("profiles").select("display_name").eq("id", msg.sender_id).maybeSingle(),
  ]);

  const { data: targets } = await db.rpc("push_targets_for_conversation", {
    _conv: msg.conversation_id,
    _sender: msg.sender_id,
  });

  const rows = (targets ?? []) as unknown as Row[];
  const invalid: string[] = [];
  let sent = 0;
  let failed = 0;

  // Kelompokkan per preferensi pratinjau: isi pesan tidak boleh bocor ke
  // perangkat yang mematikan pratinjau layar kunci.
  for (const allowPreview of [true, false]) {
    const group = rows.filter((r) => Boolean(r["allow_preview"]) === allowPreview);
    if (group.length === 0) continue;
    const chatTitle =
      (conv?.type === "group" ? conv?.title : sender?.display_name) ?? sender?.display_name ?? "MCM";
    const data: PushData = {
      kind: "message",
      channel: CHANNELS.messages.id,
      group: String(msg.conversation_id),
      route: `/chat/${msg.conversation_id}?m=${msg.id}`,
      conversationId: String(msg.conversation_id),
      messageId: String(msg.id),
      canReply: "1",
      title: notificationTitle(String(chatTitle), allowPreview),
      body:
        conv?.type === "group" && allowPreview
          ? `${sender?.display_name ?? "Anggota"}: ${previewBody(String(msg.kind), String(msg.body ?? ""), true)}`
          : previewBody(String(msg.kind), String(msg.body ?? ""), allowPreview),
    };
    const list: PushTarget[] = group.map((r) => ({
      token: String(r["push_token"]),
      sound: Boolean(r["sound"]),
      vibrate: Boolean(r["vibrate"]),
    }));
    const res = await sendPush(list, data);
    sent += res.sent;
    failed += res.failed;
    invalid.push(...res.invalidTokens);
  }

  await pruneTokens(invalid);
  return { configured: true, sent, failed, invalidTokens: invalid };
}

export type EventPush = {
  kind: PushKind;
  category: NotifCategory;
  userId: string;
  title: string;
  body: string;
  route: string;
  jobId?: string | undefined;
  orderId?: string | undefined;
  ledgerId?: string | undefined;
};

/** Push non-chat: tugas penyiapan, penjualan/pesanan, hutang/pembayaran. */
export async function dispatchEventPush(event: EventPush): Promise<FcmResult> {
  if (!pushConfigured()) {
    return { configured: false, sent: 0, failed: 0, invalidTokens: [], reason: "FCM belum terhubung" };
  }
  const db = await admin();
  const { data } = await db.rpc("push_targets_for_user", { _user: event.userId, _category: event.category });
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return { configured: true, sent: 0, failed: 0, invalidTokens: [] };

  const channel =
    event.category === "tasks"
      ? CHANNELS.tasks.id
      : event.category === "sales"
        ? CHANNELS.sales.id
        : event.category === "ledger"
          ? CHANNELS.ledger.id
          : CHANNELS.general.id;

  const invalid: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const allowPreview of [true, false]) {
    const group = rows.filter((r) => Boolean(r["allow_preview"]) === allowPreview);
    if (group.length === 0) continue;
    const payload: PushData = {
      kind: event.kind,
      channel,
      group: event.jobId ?? event.orderId ?? event.ledgerId ?? event.kind,
      route: event.route,
      ...(event.jobId ? { jobId: event.jobId } : {}),
      ...(event.orderId ? { orderId: event.orderId } : {}),
      ...(event.ledgerId ? { ledgerId: event.ledgerId } : {}),
      title: event.title,
      body: allowPreview ? event.body : "Ada pembaruan baru di MCM",
    };
    const res = await sendPush(
      group.map((r) => ({
        token: String(r["push_token"]),
        sound: Boolean(r["sound"]),
        vibrate: Boolean(r["vibrate"]),
      })),
      payload,
    );
    sent += res.sent;
    failed += res.failed;
    invalid.push(...res.invalidTokens);
  }

  await pruneTokens(invalid);
  return { configured: true, sent, failed, invalidTokens: invalid };
}
