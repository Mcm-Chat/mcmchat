import { supabase } from "@/integrations/supabase/client";

export { supabase };

/** Bungkus error PostgREST jadi pesan yang aman ditampilkan (tanpa detail internal). */
export function unwrap<T>(res: { data: T; error: { message: string } | null }, fallback: string): NonNullable<T> {
  if (res.error) throw new Error(friendly(res.error.message, fallback));
  if (res.data === null || res.data === undefined) throw new Error(fallback);
  return res.data as NonNullable<T>;
}

export function friendly(message: string, fallback: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("permission denied")) return "Anda tidak memiliki akses untuk tindakan ini.";
  if (m.includes("duplicate key")) return "Data sudah ada.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Koneksi bermasalah. Coba lagi.";
  return message || fallback;
}

export const nowIso = () => new Date().toISOString();
