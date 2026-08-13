import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { registerSubscription } from "@/lib/realtime/connection";
import { getStatusPreferences, loadFeed, statusMediaUrl } from "@/lib/api/status";

export const statusKeys = {
  feed: (uid: string) => ["status", "feed", uid] as const,
  prefs: (uid: string) => ["status", "prefs", uid] as const,
  viewers: (statusId: string) => ["status", "viewers", statusId] as const,
  media: (path: string) => ["status", "media", path] as const,
};

export const useStatusFeed = (uid?: string) =>
  useQuery({
    queryKey: statusKeys.feed(uid ?? ""),
    queryFn: () => loadFeed(uid!),
    enabled: !!uid,
    staleTime: 15_000,
  });

export const useStatusPrefs = (uid?: string) =>
  useQuery({
    queryKey: statusKeys.prefs(uid ?? ""),
    queryFn: () => getStatusPreferences(uid!),
    enabled: !!uid,
  });

/** URL bertanda tangan untuk media status (cache singkat di layer storage). */
export const useStatusMedia = (path: string | null | undefined) =>
  useQuery({
    queryKey: statusKeys.media(path ?? ""),
    queryFn: () => statusMediaUrl(path!),
    enabled: !!path,
    staleTime: 10 * 60_000,
  });

/** Status baru/terhapus dan tanda dilihat langsung menyegarkan feed. */
export function useStatusRealtime(uid?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!uid) return;
    const refresh = () => void qc.invalidateQueries({ queryKey: ["status"] });
    return registerSubscription(`mcm-status-${uid}`, (name) =>
      supabase
        .channel(name)
        .on("postgres_changes", { event: "*", schema: "public", table: "statuses" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "status_items" }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "status_views" }, refresh)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "status_reactions" },
          refresh,
        ),
    );
  }, [uid, qc]);
}
