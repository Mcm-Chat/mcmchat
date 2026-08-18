import { Activity, Eye, Radio, Timer, Users } from "lucide-react";
import { useConnectionState } from "@/lib/realtime/connection";
import { cn } from "@/lib/utils";
import { sisaWaktu, type StatusGroup } from "@/lib/status/model";

const CONN: Record<
  ReturnType<typeof useConnectionState>,
  { label: string; dot: string; text: string }
> = {
  online: { label: "Tersambung langsung", dot: "bg-emerald-500", text: "text-emerald-600" },
  connecting: { label: "Menyambungkan ulang…", dot: "bg-amber-500", text: "text-amber-600" },
  offline: { label: "Tidak ada koneksi", dot: "bg-destructive", text: "text-destructive" },
};

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Eye;
  value: string;
  label: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-muted/50 px-3 py-2.5">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      <p className="mt-1 truncate text-base font-bold leading-tight">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Ringkasan aktivitas status. Seluruh angka dihitung dari feed nyata milik
 * pengguna (bukan contoh), dan indikator koneksi memakai status realtime
 * sebenarnya — bukan penanda statis.
 */
export function StatusOverview({ groups }: { groups: StatusGroup[] }) {
  const state = useConnectionState();
  const conn = CONN[state];

  const mine = groups.find((g) => g.mine) ?? null;
  const others = groups.filter((g) => !g.mine);
  const belumDilihat = others.filter((g) => !g.muted && g.unseen > 0);
  const slideBaru = belumDilihat.reduce((n, g) => n + g.unseen, 0);

  return (
    <section
      aria-label="Ringkasan aktivitas status"
      className="card-soft space-y-3 px-4 py-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Aktivitas status</h2>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={cn("flex items-center gap-1.5 text-[11px] font-medium", conn.text)}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              conn.dot,
              state === "connecting" && "animate-pulse",
            )}
          />
          {conn.label}
        </span>
      </div>

      <div className="flex gap-2">
        <Metric
          icon={Radio}
          value={mine ? `${mine.items.length}` : "0"}
          label={mine ? "slide status saya" : "belum ada status saya"}
        />
        <Metric icon={Eye} value={`${slideBaru}`} label="slide belum dilihat" />
        <Metric icon={Users} value={`${others.length}`} label="kontak aktif" />
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Timer className="size-3.5 shrink-0" aria-hidden />
        {mine
          ? `Status saya ${sisaWaktu(mine.expiresAt)}.`
          : "Belum ada status aktif dari akun ini."}
        {belumDilihat.length > 0
          ? ` ${belumDilihat.length} kontak punya pembaruan baru.`
          : " Semua pembaruan kontak sudah dilihat."}
      </p>
    </section>
  );
}
