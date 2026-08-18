import { z } from "zod";
import { isValidPin, normalizePin } from "@/lib/api/contacts";

/** Pesan error ramah (Bahasa Indonesia) untuk validasi form di seluruh aplikasi. */

export function pinError(raw: string): string | null {
  const value = normalizePin(raw);
  if (!value) return "PIN wajib diisi.";
  const compact = value.replace("-", "");
  if (compact.length < 8) return `PIN harus 8 karakter (baru ${compact.length}). Contoh: A2B3-C4D5.`;
  if (compact.length > 8) return "PIN terlalu panjang — hanya 8 karakter. Contoh: A2B3-C4D5.";
  if (!isValidPin(value)) return "PIN hanya boleh huruf A–Z dan angka, tanpa 0/O/I/1.";
  return null;
}

export const ledgerSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Nominal wajib diisi.")
    .regex(/^\d+$/, "Nominal hanya boleh angka, tanpa titik atau huruf.")
    .refine((v) => Number(v) > 0, "Nominal harus lebih dari nol.")
    .refine((v) => Number(v) <= 1_000_000_000_000, "Nominal terlalu besar."),
  dueDate: z
    .string()
    .trim()
    .min(1, "Tanggal jatuh tempo wajib diisi.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid.")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Tanggal tidak valid."),
  counterpart: z.string().trim().min(1, "Pilih lawan transaksi dari daftar kontak."),
  note: z.string().max(200, "Keterangan maksimal 200 karakter."),
});

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Nama minimal 3 karakter.")
    .max(60, "Nama maksimal 60 karakter."),
  bio: z.string().trim().max(140, "Bio maksimal 140 karakter."),
});

/** Ubah hasil safeParse zod menjadi peta { field: pesan } yang siap dirender. */
export function fieldErrors<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): Record<string, string> {
  const res = schema.safeParse(value);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
