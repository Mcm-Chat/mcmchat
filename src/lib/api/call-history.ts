/**
 * Penghapusan riwayat panggilan — bersifat per pengguna.
 *
 * Baris `calls` adalah catatan bersama kedua pihak, jadi menghapusnya secara
 * fisik akan menghilangkan riwayat lawan bicara. Karena itu penghapusan
 * dicatat di `call_log_hides` (RLS self-scoped): entri hilang permanen dari
 * daftar milik pengguna ini di semua perangkat, tanpa menyentuh riwayat orang lain.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendly } from "./db";

export async function listHiddenCallIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("call_log_hides")
    .select("call_id")
    .eq("user_id", userId);
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.call_id));
}

/** Hapus satu atau beberapa entri riwayat dari daftar pengguna ini. */
export async function hideCalls(userId: string, callIds: string[]): Promise<void> {
  const ids = [...new Set(callIds)].filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("call_log_hides")
    .upsert(
      ids.map((call_id) => ({ user_id: userId, call_id })),
      { onConflict: "user_id,call_id" },
    );
  if (error) throw new Error(friendly(error.message, "Gagal menghapus riwayat panggilan"));
}

/** Batalkan penghapusan (dipakai tombol "Urungkan" pada toast). */
export async function unhideCalls(userId: string, callIds: string[]): Promise<void> {
  const ids = [...new Set(callIds)].filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("call_log_hides")
    .delete()
    .eq("user_id", userId)
    .in("call_id", ids);
  if (error) throw new Error(friendly(error.message, "Gagal memulihkan riwayat panggilan"));
}
