import { useEffect, useState } from "react";
import { durasi } from "@/lib/mcm/format";

export type LiveCallLike = {
  status: string;
  created_at: string;
  answered_at?: string | null;
  started_at?: string | null;
  duration_sec?: number | null;
};

/** Status panggilan yang masih berjalan sehingga perlu pembaruan tiap detik. */
export const isLiveCall = (status: string) => status === "ringing" || status === "ongoing";

/** Tik 1 detik, aktif hanya saat ada panggilan berjalan agar hemat render. */
export function useSecondTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/** Label status realtime: berdering + lama dering, atau durasi berjalan. */
export function liveStatusLabel(call: LiveCallLike): string {
  const now = Date.now();
  if (call.status === "ringing") {
    const since = Math.max(0, Math.floor((now - new Date(call.created_at).getTime()) / 1000));
    return `Berdering • ${durasi(since)}`;
  }
  if (call.status === "ongoing") {
    const base = call.answered_at ?? call.started_at ?? call.created_at;
    const since = Math.max(0, Math.floor((now - new Date(base).getTime()) / 1000));
    return `Berlangsung • ${durasi(since)}`;
  }
  return "";
}
