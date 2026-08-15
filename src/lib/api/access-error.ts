import { classifyFailure, type PostgrestLikeError } from "./errors";

/**
 * Error akses (RLS/permission/JWT) yang perlu ditampilkan sebagai layar
 * fallback, bukan sekadar toast. Dipisah dari kegagalan jaringan biasa.
 */
export function isAccessError(error: unknown): boolean {
  if (!error) return false;
  const e = error as PostgrestLikeError & { message?: string };
  const code = e.code ?? "";
  if (code === "42501" || code === "PGRST301" || code === "PGRST116") return true;
  if (e.status === 401 || e.status === 403) return true;
  const text = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  if (
    text.includes("permission denied") ||
    text.includes("row-level security") ||
    text.includes("tidak memiliki akses") ||
    text.includes("jwt")
  )
    return true;
  return false;
}

/** Pesan ramah untuk pengguna, dibedakan akses vs gangguan sementara. */
export function accessErrorMessage(error: unknown): { title: string; description: string } {
  if (isAccessError(error))
    return {
      title: "Akses percakapan tertahan—coba lagi",
      description:
        "Server menolak permintaan ini untuk sementara. Coba muat ulang; bila tetap gagal, keluar lalu masuk kembali.",
    };
  if (classifyFailure(error as PostgrestLikeError) === "transient")
    return {
      title: "Koneksi bermasalah—coba lagi",
      description: "Percakapan gagal dimuat karena gangguan jaringan. Periksa koneksi Anda.",
    };
  return {
    title: "Gagal memuat percakapan",
    description: "Terjadi kesalahan saat mengambil data. Coba muat ulang.",
  };
}
