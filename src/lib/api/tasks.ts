import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type PreparationJob = Tables<"preparation_jobs">;
export type PreparationJobItem = Tables<"preparation_job_items">;
export type PreparationItemPhoto = Tables<"preparation_item_photos">;
export type JobWithItems = PreparationJob & { items: PreparationJobItem[] };

export const TASK_STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  sent: "Dikirim",
  opened: "Dibuka pegawai",
  in_progress: "Diproses",
  ready: "Siap",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

/** Semua tugas milik satu bisnis (dipakai pemilik/admin). */
export async function listBusinessJobs(businessId: string): Promise<JobWithItems[]> {
  const rows = unwrap(
    await supabase
      .from("preparation_jobs")
      .select("*, items:preparation_job_items(*)")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false }),
    "Gagal memuat daftar tugas",
  );
  return rows as unknown as JobWithItems[];
}

/** Tugas yang ditugaskan ke satu pegawai (dipakai pegawai untuk lihat "Tugas Saya"). */
export async function listAssignedJobs(userId: string): Promise<JobWithItems[]> {
  const rows = unwrap(
    await supabase
      .from("preparation_jobs")
      .select("*, items:preparation_job_items(*)")
      .eq("assigned_user_id", userId)
      .order("created_at", { ascending: false }),
    "Gagal memuat tugas saya",
  );
  return rows as unknown as JobWithItems[];
}

export async function getJobDetail(jobId: string): Promise<JobWithItems> {
  const row = unwrap(
    await supabase
      .from("preparation_jobs")
      .select("*, items:preparation_job_items(*)")
      .eq("id", jobId)
      .single(),
    "Tugas tidak ditemukan",
  );
  return row as unknown as JobWithItems;
}

export async function listItemPhotos(jobId: string): Promise<PreparationItemPhoto[]> {
  return unwrap(
    await supabase
      .from("preparation_item_photos")
      .select("*")
      .eq("job_id", jobId)
      .order("sort_order"),
    "Gagal memuat foto tugas",
  );
}

/** Admin mencabut token: link/barcode langsung tidak bisa dipakai lagi. */
export async function revokeTaskJob(jobId: string) {
  const { error } = await supabase
    .from("preparation_jobs")
    .update({ revoked_at: new Date().toISOString(), status: "cancelled" })
    .eq("id", jobId);
  if (error) throw new Error(friendly(error.message, "Gagal mencabut tautan"));
}

/** Menerbitkan ulang tautan: token lama langsung tidak berlaku. */
export async function rotateTaskToken(
  jobId: string,
  expiresHours = 168,
): Promise<{ id: string; token: string }> {
  const { data, error } = await supabase.rpc("rotate_preparation_token", {
    _job: jobId,
    _expires_hours: expiresHours,
  });
  if (error) throw new Error(friendly(error.message, "Gagal menerbitkan ulang tautan"));
  return data as unknown as { id: string; token: string };
}

export const taskUrl = (token: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/prepare/${token}`;

export async function listBusinessEmployees(businessId: string) {
  const rows = unwrap(
    await supabase
      .from("business_members")
      .select("user_id, role")
      .eq("business_id", businessId),
    "Gagal memuat pegawai",
  ) as unknown as Array<{ user_id: string; role: string }>;
  if (rows.length === 0) return [];

  const profiles = unwrap(
    await supabase
      .from("profiles")
      .select("id, display_name, avatar_color")
      .in(
        "id",
        rows.map((r) => r.user_id),
      ),
    "Gagal memuat profil pegawai",
  ) as unknown as Array<{ id: string; display_name: string | null; avatar_color: string | null }>;
  const byId = new Map(profiles.map((p) => [p.id, p]));

  return rows.map((r) => ({
    id: r.user_id,
    role: r.role,
    name: byId.get(r.user_id)?.display_name ?? "Pegawai",
    color: byId.get(r.user_id)?.avatar_color ?? "#0ea5e9",
  }));
}
