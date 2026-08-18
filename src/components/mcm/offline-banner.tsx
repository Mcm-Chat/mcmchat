import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useConnectionState } from "@/lib/realtime/connection";
import { useOutboxSize } from "@/lib/api/outbox";

/**
 * Banner global status jaringan.
 *
 * - Offline: pemberitahuan tetap ("Kamu sedang offline") + jumlah aksi yang
 *   disimpan lokal dan akan dikirim otomatis saat online.
 * - Kembali online: pesan sinkronisasi singkat, lalu hilang sendiri.
 */
export function OfflineBanner() {
  const state = useConnectionState();
  const pending = useOutboxSize();
  const [wasOffline, setWasOffline] = useState(false);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (state === "offline") {
      setWasOffline(true);
      setShowSynced(false);
      return;
    }
    if (state === "online" && wasOffline) {
      setWasOffline(false);
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [state, wasOffline]);

  if (state !== "offline" && !showSynced) return null;

  const offline = state === "offline";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-3"
      style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
    >
      <div
        className={
          "flex max-w-md items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium shadow-lg " +
          (offline
            ? "border-border bg-muted text-muted-foreground"
            : "border-primary/30 bg-primary/10 text-primary")
        }
      >
        {offline ? (
          <CloudOff aria-hidden className="size-4 shrink-0" />
        ) : pending > 0 ? (
          <RefreshCw aria-hidden className="size-4 shrink-0 animate-spin" />
        ) : (
          <Wifi aria-hidden className="size-4 shrink-0" />
        )}
        <span>
          {offline
            ? pending > 0
              ? `Kamu sedang offline · ${pending} aksi disimpan, dikirim otomatis nanti`
              : "Kamu sedang offline"
            : pending > 0
              ? `Kembali online · menyinkronkan ${pending} aksi…`
              : "Kembali online"}
        </span>
      </div>
    </div>
  );
}