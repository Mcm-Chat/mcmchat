import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PrepTask } from "./prepare.server.types";

export type { PrepItem, PrepPhoto, PrepTask } from "./prepare.server.types";

/** Token plaintext hanya dipakai untuk lookup hash; tidak pernah disimpan mentah. */
export async function jobIdFromToken(token: string): Promise<string | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await supabaseAdmin.rpc("prep_job_id_by_token", { _token: token });
  if (error) return null;
  return (data as string | null) ?? null;
}

export async function loadTask(jobId: string): Promise<PrepTask | null> {
  const { data: job } = await supabaseAdmin
    .from("preparation_jobs")
    .select("*, businesses:business_id(name)")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;

  const { data: items } = await supabaseAdmin
    .from("preparation_job_items")
    .select("*, product_variants:variant_id(base_unit, stock_type)")
    .eq("job_id", jobId)
    .order("sort_order");

  const { data: photos } = await supabaseAdmin
    .from("preparation_item_photos")
    .select("*")
    .eq("job_id", jobId)
    .order("sort_order");

  const signed = new Map<string, string | null>();
  for (const p of photos ?? []) {
    const { data } = await supabaseAdmin.storage.from("product-photos").createSignedUrl(p.storage_path, 3600);
    signed.set(p.id, data?.signedUrl ?? null);
  }

  return {
    id: job.id,
    code: job.code,
    status: job.status,
    customer_name: job.customer_name,
    notes: job.notes,
    expires_at: job.expires_at,
    completed_at: job.completed_at,
    business_name: (job as { businesses?: { name: string } | null }).businesses?.name ?? "MCM",
    items: (items ?? []).map((it) => {
      const v = (it as { product_variants?: { base_unit: string; stock_type: string } | null }).product_variants;
      return {
        id: it.id,
        product_name: it.product_name,
        variant_name: it.variant_name,
        requested_qty: Number(it.requested_qty),
        requested_unit: it.requested_unit,
        requested_qty_base: Number(it.requested_qty_base),
        actual_qty_base: it.actual_qty_base === null ? null : Number(it.actual_qty_base),
        base_unit: v?.base_unit ?? "pcs",
        stock_type: (v?.stock_type ?? "count") as "weight" | "count",
        require_photo: it.require_photo,
        require_location: it.require_location,
        status: it.status,
        notes: it.notes,
        photos: (photos ?? [])
          .filter((p) => p.job_item_id === it.id)
          .map((p) => ({
            id: p.id,
            url: signed.get(p.id) ?? null,
            lat: p.lat,
            lng: p.lng,
            accuracy: p.accuracy,
            location_label: p.location_label,
            maps_url: p.maps_url,
            caption: p.caption,
          })),
      };
    }),
  };
}

/** Pegawai hanya boleh menulis selama tugas belum selesai/dicabut. */
export async function assertWritable(jobId: string) {
  const { data } = await supabaseAdmin
    .from("preparation_jobs")
    .select("status, revoked_at, completed_at")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) throw new Error("Tugas tidak ditemukan");
  if (data.revoked_at) throw new Error("Tautan tugas sudah dicabut");
  if (data.status === "completed") throw new Error("Tugas sudah selesai dan bersifat baca-saja");
}

export async function itemBelongsToJob(itemId: string, jobId: string) {
  const { data } = await supabaseAdmin
    .from("preparation_job_items")
    .select("id")
    .eq("id", itemId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) throw new Error("Item tidak termasuk dalam tugas ini");
}
