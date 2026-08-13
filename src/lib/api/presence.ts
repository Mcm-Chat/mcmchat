import { useEffect, useState } from "react";
import { useCallback, useRef } from "react";
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
          void supabase
            .from("profiles")
            .update({ is_online: true, last_seen_at: new Date().toISOString() })
            .eq("id", uid);
        }
      });

    const beat = setInterval(() => {
      void supabase
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", uid);
    }, 60_000);

    return () => {
      clearInterval(beat);
      void supabase
        .from("profiles")
        .update({ is_online: false, last_seen_at: new Date().toISOString() })
        .eq("id", uid);
      void supabase.removeChannel(channel);
    };
  }, [uid]);

  return online;
}

/** Jeda minimum antar sinyal "sedang mengetik" yang dikirim ke lawan bicara. */
export const TYPING_THROTTLE_MS = 2500;
/** Indikator hilang sendiri bila tidak ada sinyal baru selama durasi ini. */
export const TYPING_TTL_MS = 6000;

/**
 * Indikator mengetik memakai Realtime **Broadcast** (ephemeral), bukan tulis ke
 * database. Tidak ada satu pun baris yang ditulis per ketukan tombol: sinyal
 * di-throttle dan kedaluwarsa sendiri, jadi tidak ada sampah state bila
 * pengguna menutup aplikasi mendadak.
 */
export function useTyping(conversationId: string, uid?: string) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSent = useRef(0);
  const expiry = useRef(new Map<string, number>());

  useEffect(() => {
    if (!uid || !conversationId) return;
    const channel = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const from = (payload as { userId?: string })?.userId;
        if (!from || from === uid) return;
        expiry.current.set(from, Date.now() + TYPING_TTL_MS);
        setTypingUsers([...expiry.current.keys()]);
      })
      .subscribe();

    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [user, until] of expiry.current) {
        if (until <= now) {
          expiry.current.delete(user);
          changed = true;
        }
      }
      if (changed) setTypingUsers([...expiry.current.keys()]);
    }, 1500);

    return () => {
      clearInterval(sweep);
      expiry.current.clear();
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, uid]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (!uid || now - lastSent.current < TYPING_THROTTLE_MS) return;
    lastSent.current = now;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { userId: uid } });
  }, [uid]);

  return { typingUsers, notifyTyping };
}
