/**
 * Pengingat tindak lanjut panggilan tak terjawab.
 * Semua baris self-scoped lewat RLS (`user_id = auth.uid()`).
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type CallReminder = Tables<"call_reminders">;

export type ReminderPreset = "30m" | "2h" | "besok";

export const REMINDER_PRESETS: { id: ReminderPreset; label: string }[] = [
  { id: "30m", label: "30 menit lagi" },
  { id: "2h", label: "2 jam lagi" },
  { id: "besok", label: "Besok pagi (09:00)" },
];

/** Waktu pengingat dari preset, dihitung di zona waktu perangkat. */
export function remindAtFrom(preset: ReminderPreset, now = new Date()): Date {
  if (preset === "30m") return new Date(now.getTime() + 30 * 60_000);
  if (preset === "2h") return new Date(now.getTime() + 2 * 60 * 60_000);
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

export async function listCallReminders(userId: string): Promise<CallReminder[]> {
  return unwrap(
    await supabase
      .from("call_reminders")
      .select("*")
      .eq("user_id", userId)
      .is("done_at", null)
      .order("remind_at", { ascending: true }),
    "Gagal memuat pengingat panggilan",
  );
}

export async function createCallReminder(
  userId: string,
  input: {
    remindAt: Date;
    callId?: string | null;
    conversationId?: string | null;
    peerId?: string | null;
    peerName?: string | null;
    note?: string | null;
  },
): Promise<CallReminder> {
  return unwrap(
    await supabase
      .from("call_reminders")
      .insert({
        user_id: userId,
        remind_at: input.remindAt.toISOString(),
        call_id: input.callId ?? null,
        conversation_id: input.conversationId ?? null,
        peer_id: input.peerId ?? null,
        peer_name: input.peerName ?? null,
        note: input.note ?? null,
      })
      .select("*")
      .single(),
    "Gagal menyimpan pengingat",
  );
}

export async function completeCallReminder(id: string): Promise<void> {
  unwrap(
    await supabase
      .from("call_reminders")
      .update({ done_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single(),
    "Gagal menandai pengingat selesai",
  );
}

export function dueReminders(rows: CallReminder[], now = new Date()): CallReminder[] {
  return rows.filter((r) => !r.done_at && new Date(r.remind_at).getTime() <= now.getTime());
}
