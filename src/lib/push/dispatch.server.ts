/** Logika fan-out push (server-only). Tidak pernah diimpor klien. */
import {
  CHANNELS,
  notificationTitle,
  previewBody,
  type NotifCategory,
  type PushData,
  type PushKind,
} from "./payload";
import {
  sendPush,
  sendEach,
  pushConfigured,
  type FcmResult,
  type PushMessage,
} from "./fcm.server";

type Row = Record<string, unknown>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type NotificationActionKind = "reply" | "read" | "call_answer" | "call_decline";

/**
 * Cetak SATU aksi (id + token sekali-pakai) untuk SATU tombol, di SATU
 * perangkat, pada SATU notifikasi. Tidak ada token perangkat persisten, dan
 * token mentah tidak pernah disimpan di database maupun log.
 */
export async function mintNotificationAction(input: {
  userId: string;
  deviceId: string;
  action: NotificationActionKind;
  conversationId?: string;
  messageId?: string;
  callId?: string;
  ttlSeconds: number;
}): Promise<{ actionId: string; token: string } | null> {
  const db = await admin();
  const { data, error } = await db.rpc("mint_notification_action", {
    _user: input.userId,
    _device: input.deviceId,
    _action: input.action,
    ...(input.conversationId ? { _conversation: input.conversationId } : {}),
    ...(input.messageId ? { _message: input.messageId } : {}),
    ...(input.callId ? { _call: input.callId } : {}),
    _ttl_seconds: input.ttlSeconds,
  });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { action_id?: string; token?: string }
    | null
    | undefined;
  if (!row?.action_id || !row.token) return null;
  return { actionId: row.action_id, token: row.token };
}

/** TTL aksi pesan (10 menit) dan aksi panggilan (batas dering 45 detik). */
export const MESSAGE_ACTION_TTL_SEC = 600;
export const CALL_ACTION_TTL_SEC = 45;

/**
 * Batalkan aksi yang sudah dicetak tetapi pushnya gagal terkirim, sehingga
 * token tidak pernah bisa dipakai ulang (pengiriman ke perangkat lain tidak
 * mungkin karena setiap token terikat device_id).
 */
export async function revokeNotificationActions(actionIds: string[]) {
  const ids = actionIds.filter(Boolean);
  if (ids.length === 0) return;
  const db = await admin();
  await db.rpc("revoke_notification_actions", { _ids: ids });
}

/** Bersihkan token yang ditolak FCM agar tidak dipakai lagi. */
async function pruneTokens(tokens: string[]) {
  if (tokens.length === 0) return;
  const db = await admin();
  await db
    .from("devices")
    .update({ push_token: null, revoked_at: new Date().toISOString() })
    .in("push_token", tokens);
}

/** Push pesan chat baru ke seluruh anggota lain (mute + preferensi dihormati). */
export async function dispatchMessagePush(messageId: string): Promise<FcmResult> {
  if (!pushConfigured()) {
    return {
      configured: false,
      sent: 0,
      failed: 0,
      invalidTokens: [],
      reason: "FCM belum terhubung",
    };
  }
  const db = await admin();

  const { data: msg } = await db
    .from("messages")
    .select("id, conversation_id, sender_id, kind, body")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg)
    return {
      configured: true,
      sent: 0,
      failed: 0,
      invalidTokens: [],
      reason: "pesan tidak ditemukan",
    };

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

  // Kelompokkan per preferensi pratinjau DAN per kapabilitas balas.
  // Isi pesan tidak boleh bocor ke perangkat yang mematikan pratinjau, dan
  // tombol "Balas" hanya dikirim ke penerima yang memang boleh mengirim pesan
  // di percakapan ini (server yang menentukan, bukan klien).
  for (const allowPreview of [true, false]) {
    for (const canReply of [true, false]) {
      const group = rows.filter(
        (r) => Boolean(r["allow_preview"]) === allowPreview && Boolean(r["can_reply"]) === canReply,
      );
      if (group.length === 0) continue;
      const chatTitle =
        (conv?.type === "group" ? conv?.title : sender?.display_name) ??
        sender?.display_name ??
        "MCM";
      const data: PushData = {
        kind: "message",
        channel: CHANNELS.messages.id,
        group: String(msg.conversation_id),
        route: `/chat/${msg.conversation_id}?m=${msg.id}`,
        conversationId: String(msg.conversation_id),
        messageId: String(msg.id),
        canReply: canReply ? "1" : "0",
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
      const withTokens: PushTarget[] = [];
      for (let i = 0; i < group.length; i += 1) {
        const row = group[i] as Row;
        const base = list[i] as PushTarget;
        const userId = String(row["user_id"]);
        const deviceId = String(row["device_id"]);
        const read = await mintNotificationAction({
          userId,
          deviceId,
          action: "read",
          conversationId: String(msg.conversation_id),
          messageId: String(msg.id),
          ttlSeconds: MESSAGE_ACTION_TTL_SEC,
        });
        const reply = canReply
          ? await mintNotificationAction({
              userId,
              deviceId,
              action: "reply",
              conversationId: String(msg.conversation_id),
              ttlSeconds: MESSAGE_ACTION_TTL_SEC,
            })
          : null;
        withTokens.push({
          ...base,
          extra: {
            ...(read ? { readActionId: read.actionId, readToken: read.token } : {}),
            ...(reply ? { replyActionId: reply.actionId, replyToken: reply.token } : {}),
          },
        });
      }
      const res = await sendPush(withTokens, data);
      sent += res.sent;
      failed += res.failed;
      invalid.push(...res.invalidTokens);
    }
  }

  await pruneTokens(invalid);
  return { configured: true, sent, failed, invalidTokens: invalid };
}

/**
 * Push panggilan masuk: TTL sangat pendek (sesuai batas dering 45 detik) dan
 * token aksi hanya boleh dipakai untuk `answer`/`decline` panggilan ini.
 */
export async function dispatchCallPush(input: {
  callId: string;
  callerName: string;
  kind: "audio" | "video";
}): Promise<FcmResult> {
  if (!pushConfigured()) {
    return {
      configured: false,
      sent: 0,
      failed: 0,
      invalidTokens: [],
      reason: "FCM belum terhubung",
    };
  }
  const db = await admin();
  const { data } = await db.rpc("push_targets_for_call", { _call: input.callId });
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return { configured: true, sent: 0, failed: 0, invalidTokens: [] };

  const payload: PushData = {
    kind: "call",
    channel: CHANNELS.calls.id,
    group: input.callId,
    route: `/call/${input.callId}`,
    callId: input.callId,
    title: input.callerName,
    body: input.kind === "video" ? "Panggilan video masuk" : "Panggilan suara masuk",
  };

  const targets: PushTarget[] = [];
  for (const row of rows) {
    const userId = String(row["user_id"]);
    const deviceId = String(row["device_id"]);
    // Aksi jawab dan tolak memakai token BERBEDA, keduanya kedaluwarsa
    // bersamaan dengan batas dering 45 detik.
    const answer = await mintNotificationAction({
      userId,
      deviceId,
      action: "call_answer",
      callId: input.callId,
      ttlSeconds: CALL_ACTION_TTL_SEC,
    });
    const decline = await mintNotificationAction({
      userId,
      deviceId,
      action: "call_decline",
      callId: input.callId,
      ttlSeconds: CALL_ACTION_TTL_SEC,
    });
    targets.push({
      token: String(row["push_token"]),
      sound: Boolean(row["sound"]),
      vibrate: Boolean(row["vibrate"]),
      extra: {
        // Perangkat yang mematikan pratinjau tidak pernah menerima nama penelepon
        // pada layar kunci (notifikasi memakai versi publik generik).
        preview: row["allow_preview"] ? "1" : "0",
        ...(answer ? { answerActionId: answer.actionId, answerToken: answer.token } : {}),
        ...(decline ? { declineActionId: decline.actionId, declineToken: decline.token } : {}),
      },
    });
  }

  const res = await sendPush(targets, payload, { ttlSeconds: 45 });
  await pruneTokens(res.invalidTokens);
  return res;
}

/**
 * Push "panggilan berakhir" (best-effort) ke SEMUA perangkat peserta agar
 * notifikasi panggilan yang basi langsung dibatalkan di perangkat lain.
 * TTL push panggilan masuk tetap menjadi jaring pengaman terakhir.
 */
export async function dispatchCallTerminalPush(input: {
  callId: string;
  status: string;
}): Promise<FcmResult> {
  if (!pushConfigured()) {
    return {
      configured: false,
      sent: 0,
      failed: 0,
      invalidTokens: [],
      reason: "FCM belum terhubung",
    };
  }
  const db = await admin();
  const { data } = await db.rpc("push_targets_for_call_terminal", { _call: input.callId });
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return { configured: true, sent: 0, failed: 0, invalidTokens: [] };

  const payload: PushData = {
    kind: "call_terminal",
    channel: CHANNELS.calls.id,
    group: input.callId,
    route: `/call/${input.callId}`,
    callId: input.callId,
    callStatus: input.status,
    title: "MCM",
    body: "Panggilan berakhir",
  };

  const res = await sendPush(
    rows.map((r) => ({ token: String(r["push_token"]), sound: false, vibrate: false })),
    payload,
    { ttlSeconds: 60 },
  );
  await pruneTokens(res.invalidTokens);
  return res;
}

export type EventPush = {
  kind: PushKind;
  category: NotifCategory;
  userId: string;
  title: string;
  body: string;
  route: string;
  callId?: string | undefined;
  jobId?: string | undefined;
  orderId?: string | undefined;
  ledgerId?: string | undefined;
};

/** Push non-chat: tugas penyiapan, penjualan/pesanan, hutang/pembayaran. */
export async function dispatchEventPush(event: EventPush): Promise<FcmResult> {
  if (!pushConfigured()) {
    return {
      configured: false,
      sent: 0,
      failed: 0,
      invalidTokens: [],
      reason: "FCM belum terhubung",
    };
  }
  const db = await admin();
  const { data } = await db.rpc("push_targets_for_user", {
    _user: event.userId,
    _category: event.category,
  });
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return { configured: true, sent: 0, failed: 0, invalidTokens: [] };

  const channel =
    event.category === "calls"
      ? CHANNELS.calls.id
      : event.category === "tasks"
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
      group: event.callId ?? event.jobId ?? event.orderId ?? event.ledgerId ?? event.kind,
      route: event.route,
      ...(event.callId ? { callId: event.callId } : {}),
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
