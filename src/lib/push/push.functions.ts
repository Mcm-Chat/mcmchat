import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Status koneksi push — dipakai UI untuk menampilkan "belum terhubung". */
export const getPushStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { pushConfigured } = await import("./fcm.server");
  return { configured: pushConfigured() };
});

/** Dipanggil pengirim setelah pesan tersimpan; fan-out ke perangkat penerima. */
export const notifyNewMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: msg } = await context.supabase
      .from("messages")
      .select("id, sender_id")
      .eq("id", data.messageId)
      .maybeSingle();
    // Hanya pengirim pesan itu sendiri yang boleh memicu fan-out.
    if (!msg || msg.sender_id !== context.userId) return { configured: false, sent: 0 };
    const { dispatchMessagePush } = await import("./dispatch.server");
    const res = await dispatchMessagePush(data.messageId);
    return { configured: res.configured, sent: res.sent };
  });

const eventSchema = z.object({
  kind: z.enum(["task_assigned", "task_completed", "sale", "order", "ledger"]),
  category: z.enum(["tasks", "sales", "ledger"]),
  userId: z.string().uuid(),
  title: z.string().min(1).max(120),
  body: z.string().max(300).default(""),
  route: z.string().regex(/^\/[A-Za-z0-9/_\-?=&.]*$/),
  jobId: z.string().uuid().optional(),
  orderId: z.string().uuid().optional(),
  ledgerId: z.string().uuid().optional(),
});

/** Push tugas penyiapan / penjualan / hutang ke satu pengguna terkait. */
export const notifyEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => eventSchema.parse(input))
  .handler(async ({ data }) => {
    const { dispatchEventPush } = await import("./dispatch.server");
    const res = await dispatchEventPush(data);
    return { configured: res.configured, sent: res.sent };
  });
