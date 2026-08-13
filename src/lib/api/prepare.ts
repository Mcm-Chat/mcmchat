import { supabase } from "@/integrations/supabase/client";
import { scopedKey } from "@/lib/session-scope";
import { friendly, unwrap } from "./db";
import { notifyTaskAssigned } from "@/lib/push/push.functions";
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
  return listStaff(businessId);
}

export type StaffMember = {
  id: string;
  role: string;
  name: string;
  /** PIN MCM pegawai yang sudah dikonfirmasi pemilik/admin (kosong bila belum). */
  pin: string;
  confirmedAt: string | null;
  color: string;
};

/**
 * Direktori pegawai beserta PIN MCM terkonfirmasi. PIN disimpan pada kolom
 * khusus `business_members.staff_pin` yang dicabut dari grant tabel, jadi
 * hanya fungsi ini (dan hanya untuk pemilik/admin) yang bisa membacanya.
 */
export async function listStaff(businessId: string): Promise<StaffMember[]> {
  const { data, error } = await supabase.rpc("business_staff_directory", { _business: businessId });
  if (error) throw new Error(friendly(error.message, "Gagal memuat pegawai"));
  return ((data ?? []) as Array<{
    user_id: string;
    role: string;
    display_name: string;
    avatar_color: string;
    staff_pin: string | null;
    pin_confirmed_at: string | null;
  }>).map((r) => ({
    id: r.user_id,
    role: r.role,
    name: r.display_name || "Pegawai",
    pin: r.staff_pin ?? "",
    confirmedAt: r.pin_confirmed_at,
    color: r.avatar_color || "emerald",
  }));
}

export const normalizePin = (pin: string) => pin.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Menyimpan + mengonfirmasi nomor MCM pegawai pada kolom khusus. Nomor harus
 * benar-benar terdaftar; bila belum jadi anggota, pegawai langsung ditambahkan.
 */
export async function confirmStaffPin(input: {
  businessId: string;
  pin: string;
  role?: string;
  label?: string;
}): Promise<StaffMember> {
  const pin = normalizePin(input.pin);
  if (pin.length < 4) throw new Error("Nomor MCM pegawai tidak valid");
  const { data, error } = await supabase.rpc("confirm_staff_pin", {
    _business: input.businessId,
    _pin: pin,
    _role: (input.role ?? "agent") as never,
    _label: input.label ?? "",
  });
  if (error) throw new Error(friendly(error.message, "Gagal menyimpan PIN pegawai"));
  const row = data as unknown as { user_id: string; role: string; pin: string; name: string; confirmed_at: string };
  return { id: row.user_id, role: row.role, name: row.name, pin: row.pin, confirmedAt: row.confirmed_at, color: "emerald" };
}

/**
 * Mengirim perintah penyiapan ke PIN MCM pegawai: pesan berisi rincian dan
 * tautan pengisian masuk ke chat pribadi pegawai (dibuat bila belum ada).
 */
export async function deliverPreparationJob(jobId: string, link: string): Promise<{ conversationId: string; pin: string }> {
  const { data, error } = await supabase.rpc("deliver_preparation_job", { _job: jobId, _link: link });
  if (error) throw new Error(friendly(error.message, "Gagal mengirim tugas ke pegawai"));
  const row = data as unknown as { conversation_id: string; pin: string };
  return { conversationId: row.conversation_id, pin: row.pin };
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
  // Push hanya setelah tugas benar-benar tersimpan; target ditentukan server
  // dari baris tugas itu sendiri, bukan dari input klien.
  void notifyTaskAssigned({ data: { jobId: job.id } }).catch(() => undefined);
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
const tokenKey = () => scopedKey("prep-tokens");

function tokenMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(tokenKey()) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberToken(jobId: string, token: string) {
  if (typeof localStorage === "undefined") return;
  const map = tokenMap();
  map[jobId] = token;
  localStorage.setItem(tokenKey(), JSON.stringify(map));
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
