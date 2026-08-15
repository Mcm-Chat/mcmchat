import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenSchema = z.object({ token: z.string().min(20).max(120) });

export const getPrepareTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { jobIdFromToken, loadTask } = await import("./prepare.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) return { ok: false as const, reason: "invalid" as const };
    const task = await loadTask(jobId);
    if (!task) return { ok: false as const, reason: "invalid" as const };
    return { ok: true as const, task };
  });

export const openPrepareTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { jobIdFromToken } = await import("./prepare.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) return { ok: false as const };
    await supabaseAdmin
      .from("preparation_jobs")
      .update({ status: "opened", opened_at: new Date().toISOString() })
      .eq("id", jobId)
      .in("status", ["sent"]);
    return { ok: true as const };
  });

export const savePrepareItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20),
        itemId: z.string().uuid(),
        actualQtyBase: z.number().nonnegative().max(100_000_000).nullable(),
        notes: z.string().max(400).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { jobIdFromToken, assertWritable, itemBelongsToJob } = await import("./prepare.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) throw new Error("Tautan tidak berlaku");
    await assertWritable(jobId);
    await itemBelongsToJob(data.itemId, jobId);
    await supabaseAdmin
      .from("preparation_job_items")
      .update({
        actual_qty_base: data.actualQtyBase,
        notes: data.notes,
        status: "in_progress",
      })
      .eq("id", data.itemId);
    await supabaseAdmin
      .from("preparation_jobs")
      .update({ status: "in_progress" })
      .eq("id", jobId)
      .in("status", ["sent", "opened"]);
    return { ok: true as const };
  });

export const addPreparePhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20),
        itemId: z.string().uuid(),
        dataUrl: z.string().startsWith("data:image/").max(8_000_000),
        lat: z.number().nullable(),
        lng: z.number().nullable(),
        accuracy: z.number().nullable(),
        label: z.string().max(160).default(""),
        mapsUrl: z.string().max(300).default(""),
        caption: z.string().max(200).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { jobIdFromToken, assertWritable, itemBelongsToJob } = await import("./prepare.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) throw new Error("Tautan tidak berlaku");
    await assertWritable(jobId);
    await itemBelongsToJob(data.itemId, jobId);

    const { data: job } = await supabaseAdmin
      .from("preparation_jobs")
      .select("business_id")
      .eq("id", jobId)
      .single();
    const bytes = Buffer.from(data.dataUrl.split(",")[1] ?? "", "base64");
    const path = `${job!.business_id}/prep/${jobId}/${crypto.randomUUID()}.jpg`;
    const up = await supabaseAdmin.storage
      .from("product-photos")
      .upload(path, bytes, { contentType: "image/jpeg" });
    if (up.error) throw new Error("Foto gagal diunggah");

    const { count } = await supabaseAdmin
      .from("preparation_item_photos")
      .select("id", { count: "exact", head: true })
      .eq("job_item_id", data.itemId);

    const { error } = await supabaseAdmin.from("preparation_item_photos").insert({
      job_id: jobId,
      job_item_id: data.itemId,
      storage_path: path,
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      location_label: data.label,
      maps_url: data.mapsUrl,
      caption: data.caption,
      sort_order: count ?? 0,
    });
    if (error) {
      // Rollback rapi: jangan tinggalkan berkas yatim saat baris gagal tersimpan.
      await supabaseAdmin.storage
        .from("product-photos")
        .remove([path])
        .catch(() => undefined);
      throw new Error("Foto gagal disimpan");
    }
    return { ok: true as const };
  });

export const removePreparePhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ token: z.string().min(20), photoId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { jobIdFromToken, assertWritable } = await import("./prepare.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) throw new Error("Tautan tidak berlaku");
    await assertWritable(jobId);
    const { data: photo } = await supabaseAdmin
      .from("preparation_item_photos")
      .select("id, storage_path")
      .eq("id", data.photoId)
      .eq("job_id", jobId)
      .maybeSingle();
    if (!photo) throw new Error("Foto tidak ditemukan");
    await supabaseAdmin.storage.from("product-photos").remove([photo.storage_path]);
    await supabaseAdmin.from("preparation_item_photos").delete().eq("id", photo.id);
    return { ok: true as const };
  });

export const completePrepareTask = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { jobIdFromToken, loadTask } = await import("./prepare.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) throw new Error("Tautan tidak berlaku");

    const { data: result, error } = await supabaseAdmin.rpc("complete_preparation_job", {
      _job: jobId,
    });
    if (error) throw new Error(error.message);
    const payload = result as unknown as { already: boolean; photos: number };

    if (!payload.already) {
      const task = await loadTask(jobId);
      const { data: job } = await supabaseAdmin
        .from("preparation_jobs")
        .select("conversation_id, assigned_user_id, code, customer_name")
        .eq("id", jobId)
        .single();
      if (job?.conversation_id && task) {
        const ringkas = task.items
          .map(
            (i) =>
              `${i.product_name} — ${i.variant_name}: ${i.actual_qty_base ?? i.requested_qty_base} ${i.base_unit}`,
          )
          .join(" • ");
        await supabaseAdmin.from("messages").insert({
          conversation_id: job.conversation_id,
          sender_id: job.assigned_user_id,
          kind: "system",
          body: `Penyiapan ${job.code} selesai — ${ringkas}. Hasil foto & lokasi otomatis masuk katalog.`,
          payload: { prep_job_id: jobId, kind: "preparation_completed" } as never,
        });
      }
      // Beri tahu admin/pembuat tugas bahwa penyiapan sudah selesai.
      const { data: full } = await supabaseAdmin
        .from("preparation_jobs")
        .select("created_by, code, customer_name")
        .eq("id", jobId)
        .maybeSingle();
      if (full?.created_by) {
        const { dispatchEventPush } = await import("@/lib/push/dispatch.server");
        await dispatchEventPush({
          kind: "task_completed",
          category: "tasks",
          userId: full.created_by,
          title: "Penyiapan selesai",
          body: `${full.code} • ${full.customer_name || "pelanggan"} siap diperiksa`,
          route: `/tasks/${jobId}`,
          jobId,
        }).catch(() => undefined);
      }
    }
    return { ok: true as const, already: payload.already };
  });

/** Ringkasan hasil penyiapan (dipakai untuk chat pelanggan & konfirmasi penjual). */
function buildSummary(
  task: { code: string; customer_name: string | null; items: Array<Record<string, unknown>> },
  note: string,
) {
  const lines = task.items.map((raw) => {
    const i = raw as {
      product_name: string;
      variant_name: string;
      actual_qty_base: number | null;
      requested_qty_base: number;
      base_unit: string;
      photos: Array<{ maps_url: string | null }>;
    };
    const maps = i.photos.find((p) => p.maps_url)?.maps_url;
    return `• ${i.product_name} — ${i.variant_name}: ${i.actual_qty_base ?? i.requested_qty_base} ${i.base_unit}${
      maps ? ` (lokasi: ${maps})` : ""
    }`;
  });
  return [
    `Hasil penyiapan ${task.code}${task.customer_name ? ` untuk ${task.customer_name}` : ""}:`,
    ...lines,
    note.trim() ? `Catatan: ${note.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const sendPrepareResult = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20),
        target: z.enum(["customer", "seller"]),
        note: z.string().max(300).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { jobIdFromToken, loadTask } = await import("./prepare.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) throw new Error("Tautan tidak berlaku");
    const task = await loadTask(jobId);
    if (!task) throw new Error("Tugas tidak ditemukan");
    if (task.status !== "completed")
      throw new Error("Selesaikan tugas dulu sebelum mengirim hasil");

    const { data: job } = await supabaseAdmin
      .from("preparation_jobs")
      .select("conversation_id, assigned_user_id, created_by, code, customer_name")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) throw new Error("Tugas tidak ditemukan");

    const summary = buildSummary(task, data.note);

    if (data.target === "customer") {
      if (!job.conversation_id)
        throw new Error("Tugas ini belum terhubung ke chat pelanggan. Gunakan tombol Bagikan.");
      const { error } = await supabaseAdmin.from("messages").insert({
        conversation_id: job.conversation_id,
        sender_id: job.assigned_user_id,
        kind: "system",
        body: summary,
        payload: { prep_job_id: jobId, kind: "preparation_result" } as never,
      });
      if (error) throw new Error("Gagal mengirim ke chat pelanggan");
      return { ok: true as const, summary };
    }

    if (!job.created_by) throw new Error("Penjual pengirim tautan tidak ditemukan");
    const { dispatchEventPush } = await import("@/lib/push/dispatch.server");
    await dispatchEventPush({
      kind: "task_completed",
      category: "tasks",
      userId: job.created_by,
      title: `Konfirmasi penyiapan ${job.code}`,
      body: data.note.trim() || `${job.customer_name || "Pelanggan"} • hasil siap diperiksa`,
      route: `/tasks/${jobId}`,
      jobId,
    }).catch(() => undefined);
    if (job.conversation_id) {
      await supabaseAdmin.from("messages").insert({
        conversation_id: job.conversation_id,
        sender_id: job.assigned_user_id,
        kind: "system",
        body: `Konfirmasi ke penjual: ${summary}`,
        payload: { prep_job_id: jobId, kind: "preparation_confirmed" } as never,
      });
    }
    return { ok: true as const, summary };
  });

/** Selesaikan penyiapan + catat penjualan/piutang + kirim satu bubble hasil. */
export const sendPrepareSale = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20),
        idempotencyKey: z.string().min(8).max(80),
        prices: z
          .array(
            z.object({
              itemId: z.string().uuid(),
              price: z.number().nonnegative().max(1_000_000_000),
              discount: z.number().nonnegative().max(1_000_000_000).default(0),
            }),
          )
          .min(1),
        discount: z.number().nonnegative().max(1_000_000_000).default(0),
        extraFee: z.number().nonnegative().max(1_000_000_000).default(0),
        paymentMethod: z.enum(["cash", "transfer", "dp", "credit"]),
        paidAmount: z.number().nonnegative().max(1_000_000_000).default(0),
        dueDate: z.string().max(20).nullable().default(null),
        note: z.string().max(300).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { jobIdFromToken } = await import("./prepare.server");
    const { runPrepareSale } = await import("./prepare-sale.server");
    const jobId = await jobIdFromToken(data.token);
    if (!jobId) throw new Error("Tautan tidak berlaku");
    return runPrepareSale({ ...data, jobId });
  });
