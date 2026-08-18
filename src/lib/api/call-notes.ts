/**
 * Catatan singkat per panggilan. Milik pribadi: RLS membatasi baris ke
 * `user_id = auth.uid()`, jadi lawan bicara tidak pernah melihat catatan ini.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap, friendly } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type CallNote = Tables<"call_notes">;

export const CALL_NOTE_MAX = 500;

/** Semua catatan milik pengguna, dipetakan per `call_id` agar mudah dipakai daftar. */
export async function listCallNotes(userId: string): Promise<Record<string, CallNote>> {
  const rows = unwrap(
    await supabase.from("call_notes").select("*").eq("user_id", userId),
    "Gagal memuat catatan panggilan",
  );
  const map: Record<string, CallNote> = {};
  for (const r of rows) map[r.call_id] = r;
  return map;
}

/** Simpan (buat atau perbarui) catatan satu panggilan. */
export async function saveCallNote(
  userId: string,
  callId: string,
  note: string,
): Promise<CallNote> {
  const text = note.trim().slice(0, CALL_NOTE_MAX);
  if (!text) throw new Error("Catatan tidak boleh kosong.");
  return unwrap(
    await supabase
      .from("call_notes")
      .upsert({ user_id: userId, call_id: callId, note: text }, { onConflict: "user_id,call_id" })
      .select("*")
      .single(),
    "Gagal menyimpan catatan panggilan",
  );
}

export async function deleteCallNote(userId: string, callId: string): Promise<void> {
  const { error } = await supabase
    .from("call_notes")
    .delete()
    .eq("user_id", userId)
    .eq("call_id", callId);
  if (error) throw new Error(friendly(error.message, "Gagal menghapus catatan panggilan"));
}