import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Endpoint aksi notifikasi latar (inline reply, tandai dibaca, delivered).
 *
 * Keamanan:
 * - TIDAK memakai Supabase access token. Perangkat memakai kredensial aksi
 *   device-scoped (`<prefix>.<secret>`) yang dibuat `register_push_device`,
 *   disimpan di Android Keystore/EncryptedSharedPreferences, dan hanya
 *   sidik jarinya (SHA-256) yang tersimpan di server.
 * - Kredensial diverifikasi di dalam fungsi database `SECURITY DEFINER`
 *   yang juga memeriksa keanggotaan percakapan; tidak ada bypass RLS di sini.
 * - Semua aksi memakai `idempotencyKey` sehingga retry FCM/receiver native
 *   tidak menggandakan balasan.
 * - Respons tidak pernah memuat token, secret, atau data pengguna lain.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
} as const;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reply"),
    token: z.string().min(20).max(200),
    conversationId: z.string().uuid(),
    body: z.string().min(1).max(4000),
    actionId: z.string().min(4).max(120),
  }),
  z.object({
    action: z.literal("read"),
    token: z.string().min(20).max(200),
    conversationId: z.string().uuid(),
    actionId: z.string().min(4).max(120),
  }),
  z.object({
    action: z.literal("delivered"),
    token: z.string().min(20).max(200),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.enum(["answer", "decline"]),
    token: z.string().min(20).max(200),
    callId: z.string().uuid(),
    actionId: z.string().min(4).max(120),
  }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/push/actions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = schema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "invalid_request" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (parsed.action === "reply") {
          const { data, error } = await supabaseAdmin.rpc("bg_reply_message", {
            _token: parsed.token,
            _conv: parsed.conversationId,
            _body: parsed.body,
            _action_id: parsed.actionId,
          });
          if (error) return json({ ok: false, error: "action_failed" }, 500);
          const result = data as { ok?: boolean; error?: string } | null;
          if (!result?.ok) return json({ ok: false, error: result?.error ?? "denied" }, 401);
          // Kirim push ke anggota lain untuk balasan dari notifikasi.
          const messageId = (result as { message_id?: string }).message_id;
          if (messageId) {
            const { dispatchMessagePush } = await import("@/lib/push/dispatch.server");
            await dispatchMessagePush(messageId);
          }
          return json({
            ok: true,
            duplicate: Boolean((result as { duplicate?: boolean }).duplicate),
          });
        }

        if (parsed.action === "read") {
          const { data, error } = await supabaseAdmin.rpc("bg_mark_read", {
            _token: parsed.token,
            _conv: parsed.conversationId,
            _action_id: parsed.actionId,
          });
          if (error) return json({ ok: false, error: "action_failed" }, 500);
          const result = data as { ok?: boolean; read_receipts?: boolean } | null;
          if (!result?.ok) return json({ ok: false, error: "denied" }, 401);
          // `read_receipts: false` → notifikasi lokal boleh dibersihkan,
          // tetapi pengirim tidak pernah melihat `read_at`.
          return json({ ok: true, readReceipts: result.read_receipts !== false });
        }

        if (parsed.action === "answer" || parsed.action === "decline") {
          const { data, error } = await supabaseAdmin.rpc("bg_call_action", {
            _token: parsed.token,
            _call: parsed.callId,
            _action: parsed.action,
            _action_id: parsed.actionId,
          });
          if (error) return json({ ok: false, error: "action_failed" }, 500);
          const result = data as { ok?: boolean; error?: string; status?: string } | null;
          if (!result?.ok) return json({ ok: false, error: result?.error ?? "denied" }, 401);
          return json({ ok: true, status: result.status ?? null });
        }

        const { data, error } = await supabaseAdmin.rpc("bg_mark_delivered", {
          _token: parsed.token,
          _conv: parsed.conversationId,
          ...(parsed.messageId ? { _message: parsed.messageId } : {}),
        });
        if (error) return json({ ok: false, error: "action_failed" }, 500);
        const result = data as { ok?: boolean } | null;
        if (!result?.ok) return json({ ok: false, error: "denied" }, 401);
        return json({ ok: true });
      },
    },
  },
});
