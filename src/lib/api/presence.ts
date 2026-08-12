import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Presence sederhana berbasis Supabase Realtime Presence.
 * Dipakai HANYA untuk status profil/header (online, terakhir dilihat).
 * Status centang pesan tidak pernah diturunkan dari presence — sumber
 * kebenarannya `message_receipts`.
 */
export function usePresence(uid?: string): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    const channel = supabase.channel("mcm-presence", { config: { presence: { key: uid } } });

    const sync = () => {
      const state = channel.presenceState();
      setOnline(new Set(Object.keys(state)));
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ at: new Date().toISOString() });
          void supabase.from("profiles").update({ is_online: true, last_seen_at: new Date().toISOString() }).eq("id", uid);
        }
      });

    const beat = setInterval(() => {
      void supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", uid);
    }, 60_000);

    return () => {
      clearInterval(beat);
      void supabase.from("profiles").update({ is_online: false, last_seen_at: new Date().toISOString() }).eq("id", uid);
      void supabase.removeChannel(channel);
    };
  }, [uid]);

  return online;
}
