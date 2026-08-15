/**
 * Sinkronisasi badge "panggilan tak terjawab" secara real-time.
 *
 * Realtime Postgres sudah meng-invalidate daftar panggilan saat baris `calls`
 * berubah, tetapi ada dua celah yang membuat badge terasa telat:
 * 1. Panggilan `ringing` yang tidak dijawab baru menjadi `missed` setelah
 *    seseorang memanggil `expire_stale_calls`. Tanpa pemicu, badge tidak
 *    pernah bertambah sampai halaman Panggilan dibuka.
 * 2. Saat aplikasi kembali ke depan / jaringan pulih, event realtime yang
 *    terlewat tidak pernah menyusul.
 *
 * Hook ini menutup keduanya untuk seluruh aplikasi (dipasang di guard auth),
 * jadi badge berubah otomatis tanpa membuka halaman Panggilan.
 */
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { expireStaleCalls, RING_TIMEOUT_MS, type CallRow } from "@/lib/api/calls";
import { qk } from "@/lib/api/queries";
import { onConnectionChange } from "@/lib/realtime/connection";

/** Jeda kecil setelah deadline agar server sempat menandai `missed`. */
const GRACE_MS = 1_500;

export function useMissedCallSync(uid?: string) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!uid || busy.current) return;
    busy.current = true;
    try {
      await expireStaleCalls().catch(() => undefined);
      await qc.invalidateQueries({ queryKey: qk.calls(uid) });
    } finally {
      busy.current = false;
    }
  }, [qc, uid]);

  // Jadwalkan penyegaran tepat saat panggilan berdering paling awal habis
  // waktunya, sehingga badge naik sendiri tanpa polling terus-menerus.
  useEffect(() => {
    if (!uid) return;
    let alive = true;

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      const rows = qc.getQueryData<CallRow[]>(qk.calls(uid)) ?? [];
      const deadlines = rows
        .filter((c) => c.status === "ringing")
        .map((c) => new Date(c.created_at).getTime() + RING_TIMEOUT_MS + GRACE_MS);
      if (deadlines.length === 0) return;
      const wait = Math.max(500, Math.min(...deadlines) - Date.now());
      timer.current = setTimeout(() => {
        if (alive) void refresh();
      }, wait);
    };

    schedule();
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "calls" && event.query.queryKey[1] === uid) schedule();
    });

    return () => {
      alive = false;
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [qc, refresh, uid]);

  // Susul event yang terlewat: kembali ke depan, jaringan pulih, atau
  // realtime baru tersambung lagi.
  useEffect(() => {
    if (!uid || typeof window === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOnline = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    let firstState = true;
    const offConnection = onConnectionChange((state) => {
      if (firstState) {
        firstState = false;
        return;
      }
      if (state === "online") void refresh();
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      offConnection();
    };
  }, [refresh, uid]);
}
