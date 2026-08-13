import { supabase } from "@/integrations/supabase/client";

export { supabase };

/** Bungkus error PostgREST jadi pesan yang aman ditampilkan (tanpa detail internal). */
export function unwrap<T>(
  res: { data: T; error: { message: string } | null },
  fallback: string,
): NonNullable<T> {
  if (res.error) throw new Error(friendly(res.error.message, fallback));
  if (res.data === null || res.data === undefined) throw new Error(fallback);
  return res.data as NonNullable<T>;
}

/**
 * Classifier pesan error: pengguna tidak boleh pernah melihat teks mentah
 * Postgres/PostgREST (SQLSTATE, nama constraint, nama kolom).
 */
export function friendly(message: string, fallback: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("row-level security") || m.includes("permission denied") || m.includes("jwt"))
    return "Anda tidak memiliki akses untuk tindakan ini.";
  if (m.includes("duplicate key") || m.includes("already exists"))
    return "Data dengan nama/kode tersebut sudah tersedia.";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("timeout"))
    return "Koneksi bermasalah. Coba lagi.";
  if (m.includes("invalid input syntax") && m.includes("smallint"))
    return "Isi per satuan harus bilangan bulat lebih dari nol.";
  if (m.includes("invalid input syntax") || m.includes("numeric field overflow"))
    return "Jumlah berat harus berupa angka desimal yang valid.";
  if (m.includes("product_variants_stock_model_ck") || m.includes("satuan tidak sesuai"))
    return "Satuan tidak sesuai dengan jenis stok.";
  if (m.includes("check constraint") || m.includes("violates"))
    return "Data yang dimasukkan tidak memenuhi aturan validasi.";
  if (m.includes("payload too large") || m.includes("exceeded the maximum"))
    return "Berkas terlalu besar untuk diunggah.";
  if (m.includes("quota")) return "Kuota penyimpanan habis.";
  // Pesan berbahasa Indonesia dari RAISE EXCEPTION kami sendiri aman ditampilkan.
  if (/[a-z]/.test(m) && !/[_"]|\bsql\b|\bpg_|\brelation\b|\bcolumn\b/.test(m) && /\s/.test(m))
    return message;
  return fallback;
}

export const nowIso = () => new Date().toISOString();
