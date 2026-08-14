import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Endpoint aksi notifikasi latar (balas inline, tandai dibaca, jawab/tolak panggilan).
 *
 * Model keamanan:
 * - TIDAK ada bearer persisten di perangkat. Setiap tombol notifikasi memakai
 *   SATU aksi berbeda (`actionId` + token sekali-pakai) yang dicetak server per
 *   perangkat per notifikasi. Server hanya menyimpan hash token.
 * - Verifikasi, pemeriksaan ulang kapabilitas, eksekusi, dan penandaan
 *   `used_at`/`result` terjadi atomik di dalam `consume_notification_action`
 *   (SELECT ... FOR UPDATE). Retry mengembalikan hasil tersimpan tanpa efek ganda.
 * - `actionId` adalah batas idempotensi; receiver native tidak lagi membuat
 *   kunci idempotensi sendiri.
 * - Token untuk aksi/sumber daya lain selalu ditolak.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
} as const;

const schema = z
  .object({
    action: z.enum(["reply", "read", "call_answer", "call_decline"]),
    actionId: z.string().uuid(),
    token: z.string().min(20).max(200),
    resourceId: z.string().uuid(),
    body: z.string().min(1).max(4000).optional(),
  })
  .refine((v) => (v.action === "reply" ? typeof v.body === "string" : true), {
    message: "body_required",
  });

/** Kode gagal → status HTTP; receiver native memakai ini untuk retry/berhenti. */
const STATUS: Record<string, number> = {
  invalid_token: 401,
  resource_mismatch: 401,
  expired: 401,
  device_revoked: 401,
  forbidden: 403,
  not_sendable: 403,
  invalid_body: 400,
  rate_limited: 429,
};

const TERMINAL = new Set(["ended", "declined", "missed", "failed"]);

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
        const { data, error } = await supabaseAdmin.rpc("consume_notification_action", {
          _action_id: parsed.actionId,
          _token: parsed.token,
          _resource: parsed.resourceId,
          ...(parsed.body !== undefined ? { _body: parsed.body } : {}),
        });
        if (error) return json({ ok: false, error: "action_failed" }, 500);

        const result = (data ?? null) as {
          ok?: boolean;
          error?: string;
          replayed?: boolean;
          message_id?: string;
          status?: string;
          read_receipts?: boolean;
        } | null;

        if (!result?.ok) {
          const code = result?.error ?? "denied";
          return json({ ok: false, error: code }, STATUS[code] ?? 401);
        }

        const replayed = result.replayed === true;

        // Efek samping lanjutan hanya untuk eksekusi pertama.
        if (!replayed && parsed.action === "reply" && result.message_id) {
          const { dispatchMessagePush } = await import("@/lib/push/dispatch.server");
          await dispatchMessagePush(result.message_id).catch(() => undefined);
        }
        if (!replayed && (parsed.action === "call_answer" || parsed.action === "call_decline")) {
          const { dispatchCallTerminalPush } = await import("@/lib/push/dispatch.server");
          if (TERMINAL.has(String(result.status ?? "")) || parsed.action === "call_answer") {
            await dispatchCallTerminalPush({
              callId: parsed.resourceId,
              status: String(result.status ?? "ended"),
            }).catch(() => undefined);
          }
        }

        return json({
          ok: true,
          replayed,
          ...(result.status ? { status: result.status } : {}),
          ...(result.read_receipts !== undefined ? { readReceipts: result.read_receipts } : {}),
        });
      },
    },
  },
});
