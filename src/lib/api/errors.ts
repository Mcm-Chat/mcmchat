/**
 * Klasifikasi kegagalan jaringan/database supaya outbox tahu kapan boleh
 * mencoba lagi. Menebak dari teks pesan rapuh dan berbeda antar bahasa, jadi
 * kode PostgREST/Postgres selalu dipakai lebih dulu bila tersedia.
 */
export type FailureKind = "duplicate" | "permanent" | "transient";

export type PostgrestLikeError = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
};

/** Error aplikasi yang mempertahankan kode asli agar bisa diklasifikasikan. */
export class ApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly kind: FailureKind;

  constructor(message: string, source?: PostgrestLikeError | null) {
    super(message);
    this.name = "ApiError";
    this.code = source?.code ?? null;
    this.status = source?.status ?? null;
    this.kind = classifyFailure(source ?? { message });
  }
}

/** SQLSTATE yang tidak akan pernah sembuh dengan mencoba ulang payload sama. */
const PERMANENT_SQLSTATE = new Set([
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23514", // check_violation
  "22001", // string_data_right_truncation
  "22P02", // invalid_text_representation
  "42501", // insufficient_privilege
  "42703", // undefined_column
  "42P01", // undefined_table
  "P0001", // raise_exception dari fungsi validasi kami
  "PGRST301", // JWT tidak valid / RLS menolak
  "PGRST116", // baris tidak ditemukan untuk .single()
]);

/** SQLSTATE/kondisi yang layak dicoba ulang. */
const TRANSIENT_SQLSTATE = new Set([
  "08000",
  "08003",
  "08006",
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "57014", // query_canceled
  "XX000",
]);

export function classifyFailure(error: PostgrestLikeError | Error | null | undefined): FailureKind {
  if (!error) return "transient";
  if (error instanceof ApiError) return error.kind;
  const code = "code" in error ? ((error as PostgrestLikeError).code ?? "") : "";
  const status = "status" in error ? ((error as PostgrestLikeError).status ?? 0) : 0;
  const text = `${error.message ?? ""} ${("details" in error && error.details) || ""}`.toLowerCase();

  if (code === "23505") return "duplicate";
  if (code && PERMANENT_SQLSTATE.has(code)) return "permanent";
  if (code && TRANSIENT_SQLSTATE.has(code)) return "transient";

  // HTTP: 4xx adalah kesalahan permintaan (kecuali 408/429 yang layak diulang).
  if (status === 408 || status === 429) return "transient";
  if (status >= 400 && status < 500) return "permanent";
  if (status >= 500) return "transient";

  if (text.includes("row-level security") || text.includes("permission denied") || text.includes("tidak memiliki akses"))
    return "permanent";
  if (text.includes("payload too large") || text.includes("file too large") || text.includes("terlalu besar"))
    return "permanent";
  if (text.includes("duplicate key")) return "duplicate";
  if (text.includes("failed to fetch") || text.includes("networkerror") || text.includes("timeout") || text.includes("koneksi"))
    return "transient";

  // Tidak dikenali: perlakukan sebagai sementara, tetapi outbox tetap membatasi
  // jumlah percobaan sehingga tidak ada loop tanpa akhir.
  return "transient";
}

export function isPermanent(error: unknown): boolean {
  return classifyFailure(error as PostgrestLikeError) === "permanent";
}