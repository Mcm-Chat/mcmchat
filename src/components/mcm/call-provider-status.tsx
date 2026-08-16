/**
 * Status server panggilan (LiveKit) yang terlihat langsung di layar panggilan,
 * lengkap dengan waktu pemeriksaan terakhir. Nilai diambil dari server; tidak
 * ada status palsu — bila kredensial belum aktif, statusnya "Belum terhubung".
 */
import { RefreshCcw } from "lucide-react";
import type { ProviderHealthResult } from "@/lib/calls/use-provider-health";
import { cn } from "@/lib/utils";

const CODE_TEXT: Record<string, string> = {
  provider_unconfigured: "Kredensial server panggilan belum lengkap.",
  provider_url_invalid: "Alamat server panggilan tidak valid (harus wss://).",
  network: "Status server tidak bisa diperiksa — jaringan bermasalah.",
};

function waktu(d: Date) {
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function CallProviderStatus({
  status,
  className,
}: {
  status: ProviderHealthResult;
  className?: string;
}) {
  const { health, code, checkedAt, busy, refresh } = status;
  const label =
    health === "online"
      ? "Server panggilan terhubung"
      : health === "offline"
        ? "Server panggilan belum terhubung"
        : "Memeriksa server panggilan…";

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium ring-1",
            health === "online"
              ? "bg-success/20 text-success-foreground ring-success/40"
              : health === "offline"
                ? "bg-destructive/20 text-navy-foreground ring-destructive/50"
                : "bg-white/15 text-navy-foreground ring-white/25",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full",
              health === "online"
                ? "bg-success"
                : health === "offline"
                  ? "bg-destructive"
                  : "bg-white/70 animate-pulse",
            )}
          />
          {label}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          aria-label="Perbarui status server panggilan"
          className="inline-flex size-7 items-center justify-center rounded-full bg-white/10 text-navy-foreground disabled:opacity-50"
        >
          <RefreshCcw className={cn("size-3.5", busy && "animate-spin")} />
        </button>
      </div>
      <p aria-live="polite" className="text-[11px] text-navy-foreground/70">
        {checkedAt ? `Diperbarui ${waktu(checkedAt)} WIB` : "Belum diperiksa"}
      </p>
      {health === "offline" && code && CODE_TEXT[code] && (
        <p className="max-w-[18rem] text-center text-[11px] text-navy-foreground/70">
          {CODE_TEXT[code]}
        </p>
      )}
    </div>
  );
}
