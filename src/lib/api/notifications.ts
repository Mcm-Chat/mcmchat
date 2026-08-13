import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Tables } from "@/integrations/supabase/types";

export type NotificationRow = Tables<"notifications">;

export async function listNotifications(userId: string): Promise<NotificationRow[]> {
  return unwrap(
    await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    "Gagal memuat notifikasi",
  );
}

export async function markRead(id: string) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  if (error) throw new Error(friendly(error.message, "Gagal menandai notifikasi"));
}

export async function markAllRead(userId: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) throw new Error(friendly(error.message, "Gagal menandai semua notifikasi"));
}

/** Berlangganan notifikasi baru/berubah untuk pengguna, mengembalikan fungsi unsubscribe. */
export function subscribeNotifications(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`mcm-notifications-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
