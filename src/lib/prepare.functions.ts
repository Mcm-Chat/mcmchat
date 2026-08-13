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
    if (error) throw new Error("Foto gagal disimpan");
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
