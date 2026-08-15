import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadTask } from "./prepare.server";

export type PrepSaleInput = {
  jobId: string;
  idempotencyKey: string;
  prices: Array<{ itemId: string; price: number; discount: number }>;
  discount: number;
  extraFee: number;
  paymentMethod: "cash" | "transfer" | "dp" | "credit";
  paidAmount: number;
  dueDate: string | null;
  note: string;
};

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(n)
    .replace(/\s/g, " ");

const LABEL: Record<PrepSaleInput["paymentMethod"], string> = {
  cash: "Tunai",
  transfer: "Transfer",
  dp: "DP / uang muka",
  credit: "Kredit / tempo",
};

/**
 * Satu aksi: selesaikan penyiapan (bila belum), catat penjualan + piutang secara
 * atomik, lalu kirim SATU bubble chat berisi foto hasil, link lokasi, dan status
 * hutang terbaru.
 */
export async function runPrepareSale(input: PrepSaleInput) {
  const { data: job } = await supabaseAdmin
    .from("preparation_jobs")
    .select(
      "id, business_id, conversation_id, assigned_user_id, created_by, code, customer_name, status",
    )
    .eq("id", input.jobId)
    .maybeSingle();
  if (!job) throw new Error("Tugas tidak ditemukan");

  if (job.status !== "completed") {
    const { error } = await supabaseAdmin.rpc("complete_preparation_job", { _job: input.jobId });
    if (error) throw new Error(error.message);
  }

  const task = await loadTask(input.jobId);
  if (!task) throw new Error("Tugas tidak ditemukan");

  const { data: rows } = await supabaseAdmin
    .from("preparation_job_items")
    .select("id, product_id, variant_id")
    .eq("job_id", input.jobId);
  const refs = new Map((rows ?? []).map((r) => [r.id, r]));
  const priceOf = new Map(input.prices.map((p) => [p.itemId, p]));

  const items = task.items.map((i) => {
    const p = priceOf.get(i.id);
    const qty = i.actual_qty_base ?? i.requested_qty_base;
    return {
      product_id: refs.get(i.id)?.product_id ?? null,
      variant_id: refs.get(i.id)?.variant_id ?? null,
      name: i.product_name,
      variant_name: i.variant_name,
      qty,
      qty_base: qty,
      unit: i.base_unit,
      price: p?.price ?? 0,
      discount: p?.discount ?? 0,
    };
  });

  const { data: saleRaw, error: saleErr } = await supabaseAdmin.rpc("create_prep_sale_tx", {
    _job: input.jobId,
    _payload: {
      idempotency_key: input.idempotencyKey,
      discount: input.discount,
      extra_fee: input.extraFee,
      payment_method: input.paymentMethod,
      paid_amount: input.paidAmount,
      due_date: input.dueDate,
      note: input.note,
      items,
    } as never,
  });
  if (saleErr) throw new Error(saleErr.message);
  const sale = saleRaw as unknown as {
    sale_id: string;
    ledger_id: string | null;
    total: number;
    paid: number;
    number: string;
    seller_id: string;
    already: boolean;
  };

  const outstanding = Math.max(0, Number(sale.total) - Number(sale.paid));
  const photo = task.items.flatMap((i) => i.photos).find((p) => p.url) ?? null;
  const maps = task.items.flatMap((i) => i.photos).find((p) => p.maps_url)?.maps_url ?? "";

  const body = [
    `🧾 ${sale.number} • Penyiapan ${task.code}`,
    ...task.items.map(
      (i) =>
        `• ${i.product_name} — ${i.variant_name}: ${i.actual_qty_base ?? i.requested_qty_base} ${i.base_unit}`,
    ),
    `Total ${rupiah(Number(sale.total))} • ${LABEL[input.paymentMethod]} • Dibayar ${rupiah(Number(sale.paid))}`,
    outstanding > 0
      ? `Sisa hutang ${rupiah(outstanding)}${input.dueDate ? ` • jatuh tempo ${input.dueDate}` : ""}`
      : "Lunas — tidak ada sisa hutang",
    maps ? `Lokasi: ${maps}` : "",
    input.note.trim() ? `Catatan: ${input.note.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let messageId: string | null = null;
  if (job.conversation_id && !sale.already) {
    // Foto hasil disalin ke bucket chat supaya pelanggan bisa membukanya lewat chat.
    let attachment: { path: string; size: number } | null = null;
    const src = task.items
      .flatMap((i) => i.photos.map((p) => ({ p, item: i })))
      .find((x) => x.p.url);
    if (src) {
      const { data: row } = await supabaseAdmin
        .from("preparation_item_photos")
        .select("storage_path")
        .eq("id", src.p.id)
        .maybeSingle();
      if (row) {
        const dl = await supabaseAdmin.storage.from("product-photos").download(row.storage_path);
        if (dl.data) {
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          const path = `${job.conversation_id}/${crypto.randomUUID()}.jpg`;
          const up = await supabaseAdmin.storage
            .from("chat-media")
            .upload(path, bytes, { contentType: "image/jpeg" });
          if (!up.error) attachment = { path, size: bytes.byteLength };
        }
      }
    }

    const { data: msg, error: msgErr } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: job.conversation_id,
        sender_id: job.assigned_user_id ?? sale.seller_id,
        kind: attachment ? "image" : "text",
        body,
        attachment_path: attachment?.path ?? null,
        attachment_name: attachment ? `${sale.number}.jpg` : null,
        attachment_mime: attachment ? "image/jpeg" : null,
        attachment_size: attachment?.size ?? null,
        location_lat: photo?.lat ?? null,
        location_lng: photo?.lng ?? null,
        location_accuracy: photo?.accuracy ?? null,
        location_label: photo?.location_label ?? null,
        location_maps_url: photo?.maps_url || maps || null,
        client_id: `prep-sale-${input.idempotencyKey}`,
        payload: {
          kind: "preparation_sale",
          prep_job_id: input.jobId,
          sale_id: sale.sale_id,
          ledger_id: sale.ledger_id,
          number: sale.number,
          total: Number(sale.total),
          paid: Number(sale.paid),
          outstanding,
          paymentMethod: input.paymentMethod,
          dueDate: input.dueDate,
          mapsUrl: maps || null,
        } as never,
      })
      .select("id")
      .maybeSingle();
    if (msgErr) throw new Error("Penjualan tercatat, tetapi pesan gagal dikirim");
    messageId = msg?.id ?? null;
    if (messageId) {
      await supabaseAdmin
        .from("sales_records")
        .update({ message_id: messageId })
        .eq("id", sale.sale_id);
    }
  }

  if (job.created_by && !sale.already) {
    const { dispatchEventPush } = await import("@/lib/push/dispatch.server");
    await dispatchEventPush({
      kind: "task_completed",
      category: "tasks",
      userId: job.created_by,
      title: `Penjualan ${sale.number}`,
      body: `${job.customer_name || "Pelanggan"} • ${rupiah(Number(sale.total))}${
        outstanding > 0 ? ` • sisa ${rupiah(outstanding)}` : " • lunas"
      }`,
      route: `/tasks/${input.jobId}`,
      jobId: input.jobId,
    }).catch(() => undefined);
  }

  return {
    ok: true as const,
    already: sale.already,
    number: sale.number,
    total: Number(sale.total),
    paid: Number(sale.paid),
    outstanding,
    messageId,
  };
}
