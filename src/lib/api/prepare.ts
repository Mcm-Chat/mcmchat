import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { notifyEvent } from "@/lib/push/push.functions";
import type { Tables } from "@/integrations/supabase/types";

export type ProductVariant = Tables<"product_variants">;
export type PreparationJob = Tables<"preparation_jobs">;
export type PreparationJobItem = Tables<"preparation_job_items">;
export type JobWithItems = PreparationJob & { items: PreparationJobItem[] };

/** Satuan yang valid untuk tiap kelas stok. Konversi final tetap dihitung di database. */
export const WEIGHT_UNITS = [
  { unit: "mg", factor: 0.001 },
  { unit: "g", factor: 1 },
  { unit: "ons", factor: 100 },
  { unit: "kg", factor: 1000 },
] as const;

/** Pratinjau konversi di UI; sumber kebenaran tetap fungsi convert_to_base di database. */
export function previewBase(variant: ProductVariant, qty: number, unit: string): number {
  if (variant.stock_type === "weight") {
    const f = WEIGHT_UNITS.find((u) => u.unit === unit)?.factor ?? 1;
    return Math.round(qty * f * 100) / 100;
  }
  return Math.round(qty * Number(variant.conversion_factor) * 100) / 100;
}

export function formatBase(variant: ProductVariant, qtyBase: number | string | null): string {
  const n = Number(qtyBase ?? 0);
  if (variant.stock_type === "weight") {
    return n >= 1000 ? `${(n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg` : `${n.toFixed(2)} g`;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(2)} ${variant.base_unit}`;
}

export async function listVariants(businessId: string): Promise<ProductVariant[]> {
  return unwrap(
    await supabase
      .from("product_variants")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("sort_order"),
    "Gagal memuat varian produk",
  );
}

export async function listBalances(businessId: string) {
  return unwrap(
    await supabase.from("inventory_balances").select("*").eq("business_id", businessId),
    "Gagal memuat stok",
  );
}

export async function listAgents(businessId: string) {
  const rows = unwrap(
    await supabase
      .from("business_members")
      .select("user_id, role, profiles:user_id(display_name, pin, avatar_color)")
      .eq("business_id", businessId),
    "Gagal memuat pegawai",
  ) as unknown as Array<{
    user_id: string;
    role: string;
    profiles: { display_name: string; pin: string; avatar_color: string } | null;
  }>;
  return rows.map((r) => ({
    id: r.user_id,
    role: r.role,
    name: r.profiles?.display_name ?? "Pegawai",
    pin: r.profiles?.pin ?? "",
    color: r.profiles?.avatar_color ?? "#0ea5e9",
  }));
}

export type NewJobItem = {
  variant_id: string;
  qty: number;
  unit: string;
  notes?: string;
  require_photo?: boolean;
  require_location?: boolean;
};

/**
 * Membuat satu job unik per permintaan pelanggan. Token plaintext hanya
 * dikembalikan sekali di sini (database menyimpan hash-nya saja).
 */
export async function createPreparationJob(input: {
  businessId: string;
  assignedUserId: string;
  items: NewJobItem[];
  conversationId?: string | null;
  customerId?: string | null;
  customerUserId?: string | null;
  customerName?: string;
  orderId?: string | null;
  notes?: string;
  expiresHours?: number;
}): Promise<{ id: string; code: string; token: string; expires_at: string }> {
  const args: Record<string, unknown> = {
    _business: input.businessId,
    _assigned: input.assignedUserId,
    _items: input.items,
    _customer_name: input.customerName ?? "",
    _notes: input.notes ?? "",
    _expires_hours: input.expiresHours ?? 168,
  };
  if (input.conversationId) args['_conversation'] = input.conversationId;
  if (input.customerId) args['_customer'] = input.customerId;
  if (input.customerUserId) args['_customer_user'] = input.customerUserId;
  if (input.orderId) args['_order'] = input.orderId;
  const { data, error } = await supabase.rpc("create_preparation_job", args as never);
  if (error) throw new Error(friendly(error.message, "Gagal membuat perintah penyiapan"));
  const job = data as unknown as { id: string; code: string; token: string; expires_at: string };
  void notifyEvent({
    data: {
      kind: "task_assigned",
      category: "tasks",
      userId: input.assignedUserId,
      title: "Tugas penyiapan baru",
      body: `${job.code} • ${input.items.length} item untuk ${input.customerName || "pelanggan"}`,
      route: `/tasks/${job.id}`,
      jobId: job.id,
    },
  }).catch(() => undefined);
  return job;
}

export async function listJobsForConversation(conversationId: string): Promise<JobWithItems[]> {
  const rows = unwrap(
    await supabase
      .from("preparation_jobs")
      .select("*, items:preparation_job_items(*)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }),
    "Gagal memuat daftar penyiapan",
  );
  return rows as unknown as JobWithItems[];
}

export async function getJob(jobId: string): Promise<JobWithItems> {
  const row = unwrap(
    await supabase.from("preparation_jobs").select("*, items:preparation_job_items(*)").eq("id", jobId).single(),
    "Tugas tidak ditemukan",
  );
  return row as unknown as JobWithItems;
}

/** Admin mencabut token: link/barcode langsung tidak bisa dipakai lagi. */
export async function revokeJob(jobId: string) {
  const { error } = await supabase
    .from("preparation_jobs")
    .update({ revoked_at: new Date().toISOString(), status: "cancelled" })
    .eq("id", jobId);
  if (error) throw new Error(friendly(error.message, "Gagal mencabut tautan"));
}

/** Admin membuka kembali tugas yang sudah selesai agar pegawai bisa memperbaiki. */
export async function reopenJob(jobId: string) {
  const { error } = await supabase
    .from("preparation_jobs")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", jobId);
  if (error) throw new Error(friendly(error.message, "Gagal membuka ulang tugas"));
}

export const prepareUrl = (token: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/prepare/${token}`;

/**
 * Token plaintext tidak bisa dibaca ulang dari database (hanya hash yang disimpan),
 * jadi perangkat admin menyimpan salinannya untuk menampilkan QR/tautan kembali.
 */
const TOKEN_KEY = "mcm-prep-tokens";

function tokenMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberToken(jobId: string, token: string) {
  if (typeof localStorage === "undefined") return;
  const map = tokenMap();
  map[jobId] = token;
  localStorage.setItem(TOKEN_KEY, JSON.stringify(map));
}

export function recallToken(jobId: string): string | null {
  return tokenMap()[jobId] ?? null;
}

/** Menerbitkan ulang tautan: token lama langsung tidak berlaku. */
export async function rotateToken(jobId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rotate_preparation_token", { _job: jobId });
  if (error) throw new Error(friendly(error.message, "Gagal menerbitkan ulang tautan"));
  const token = (data as unknown as { token: string }).token;
  rememberToken(jobId, token);
  return token;
}
