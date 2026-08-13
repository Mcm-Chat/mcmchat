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

const NONE = { configured: false as const, sent: 0 };

const money = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Push tugas penyiapan baru.
 *
 * Klien HANYA mengirim id tugas. Server membaca tugas dari database,
 * memverifikasi pemanggil memang pengelola bisnis tersebut, lalu menentukan
 * sendiri penerima, judul, isi, dan rute notifikasi. Klien tidak pernah bisa
 * menentukan target push arbitrer (mencegah confused deputy & spam).
 */
export const notifyTaskAssigned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: job } = await context.supabase
      .from("preparation_jobs")
      .select("id, code, business_id, assigned_user_id, customer_name, status")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) return NONE;
    const { data: canManage } = await context.supabase.rpc("can_manage_business", {
      _biz: job.business_id,
      _uid: context.userId,
    });
    if (!canManage) return NONE;
    if (job.assigned_user_id === context.userId) return NONE;

    const { count } = await context.supabase
      .from("preparation_job_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id);

    const { dispatchEventPush } = await import("./dispatch.server");
    const res = await dispatchEventPush({
      kind: "task_assigned",
      category: "tasks",
      userId: job.assigned_user_id,
      title: "Tugas penyiapan baru",
      body: `${job.code} • ${count ?? 0} item untuk ${job.customer_name || "pelanggan"}`,
      route: `/tasks/${job.id}`,
      jobId: job.id,
    });
    return { configured: res.configured, sent: res.sent };
  });

/** Push nota penjualan ke pelanggan; hanya penjual pada record itu yang boleh memicu. */
export const notifySale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ saleId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: sale } = await context.supabase
      .from("sales_records")
      .select("id, seller_id, customer_user_id, total, paid_amount, payload")
      .eq("id", data.saleId)
      .maybeSingle();
    if (!sale || sale.seller_id !== context.userId || !sale.customer_user_id) return NONE;
    if (sale.customer_user_id === context.userId) return NONE;

    const total = Number(sale.total);
    const outstanding = Math.max(0, total - Number(sale.paid_amount));
    const number = (sale.payload as { number?: string } | null)?.number ?? "";

    const { dispatchEventPush } = await import("./dispatch.server");
    const res = await dispatchEventPush({
      kind: "sale",
      category: "sales",
      userId: sale.customer_user_id,
      title: `Nota penjualan ${number}`.trim(),
      body:
        outstanding > 0
          ? `Total ${money(total)} • sisa ${money(outstanding)}`
          : `Total ${money(total)} • lunas`,
      route: "/finance",
    });
    return { configured: res.configured, sent: res.sent };
  });

/** Push pembayaran hutang ke pihak lawan pada catatan itu. */
export const notifyLedgerPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ ledgerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ledger } = await context.supabase
      .from("ledgers")
      .select("id, owner_id, counterpart_user_id, counterpart_name, amount, paid_amount, status")
      .eq("id", data.ledgerId)
      .maybeSingle();
    if (!ledger) return NONE;
    // Hanya pihak yang benar-benar terkait catatan ini; target adalah pihak lawan.
    const isOwner = ledger.owner_id === context.userId;
    const isCounterpart = ledger.counterpart_user_id === context.userId;
    if (!isOwner && !isCounterpart) return NONE;
    const target = isOwner ? ledger.counterpart_user_id : ledger.owner_id;
    if (!target || target === context.userId) return NONE;

    const outstanding = Math.max(0, Number(ledger.amount) - Number(ledger.paid_amount));

    const { dispatchEventPush } = await import("./dispatch.server");
    const res = await dispatchEventPush({
      kind: "ledger",
      category: "ledger",
      userId: target,
      title: outstanding === 0 ? "Catatan hutang lunas" : "Pembayaran dicatat",
      body:
        outstanding === 0
          ? `${ledger.counterpart_name || "Catatan"} sudah lunas`
          : `Sisa ${money(outstanding)}`,
      route: `/ledger/${ledger.id}`,
      ledgerId: ledger.id,
    });
    return { configured: res.configured, sent: res.sent };
  });

/** Notifikasi panggilan masuk (channel prioritas tinggi `mcm_calls`). */
export const notifyIncomingCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ callId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: call } = await context.supabase
      .from("calls")
      .select("id, kind, initiator_id, status")
      .eq("id", data.callId)
      .maybeSingle();
    // Hanya pemanggil yang boleh memicu notifikasi panggilannya sendiri.
    if (!call || call.initiator_id !== context.userId || call.status !== "ringing") {
      return { configured: false, sent: 0 };
    }
    const [{ data: parts }, { data: me }] = await Promise.all([
      context.supabase.from("call_participants").select("user_id").eq("call_id", call.id),
      context.supabase
        .from("profiles")
        .select("display_name")
        .eq("id", context.userId)
        .maybeSingle(),
    ]);
    const { dispatchEventPush } = await import("./dispatch.server");
    let sent = 0;
    let configured = false;
    for (const p of parts ?? []) {
      if (p.user_id === context.userId) continue;
      const res = await dispatchEventPush({
        kind: "call",
        category: "calls",
        userId: p.user_id,
        title: me?.display_name ?? "Panggilan MCM",
        body: call.kind === "video" ? "Panggilan video masuk" : "Panggilan suara masuk",
        route: `/call/${call.id}`,
        callId: call.id,
      });
      configured = configured || res.configured;
      sent += res.sent;
    }
    return { configured, sent };
  });
