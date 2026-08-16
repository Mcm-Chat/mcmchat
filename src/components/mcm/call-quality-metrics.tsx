/**
 * Panel metrik kualitas panggilan real-time (packet loss, jitter, RTT, bitrate).
 *
 * Hanya menampilkan angka yang benar-benar dilaporkan WebRTC; nilai yang tidak
 * tersedia ditulis "—" alih-alih ditebak, supaya pengguna bisa memercayainya
 * saat memutuskan pindah jaringan.
 */
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatMetric,
  gradeMetrics,
  metricsSummary,
  type QualityMetrics,
} from "@/lib/calls/quality-metrics";

const GRADE_TEXT: Record<string, string> = {
  good: "Kualitas baik",
  fair: "Kualitas sedang",
  poor: "Kualitas buruk",
  unknown: "Mengukur…",
};

const GRADE_TONE: Record<string, string> = {
  good: "text-emerald-300",
  fair: "text-amber-300",
  poor: "text-rose-300",
  unknown: "text-white/60",
};

export function CallQualityMetrics({
  metrics,
  className,
}: {
  metrics: QualityMetrics | null;
  className?: string;
}) {
  const grade = gradeMetrics(metrics);
  const items: Array<[string, string]> = [
    ["Paket hilang", formatMetric(metrics?.lossPct ?? null, "%")],
    ["Jitter", formatMetric(metrics?.jitterMs ?? null, "ms")],
    ["Latensi", formatMetric(metrics?.rttMs ?? null, "ms")],
    ["Unduh", formatMetric(metrics?.kbpsDown ?? null, "kbps")],
    ["Unggah", formatMetric(metrics?.kbpsUp ?? null, "kbps")],
  ];

  return (
    <section
      aria-label="Metrik kualitas panggilan"
      className={cn(
        "mx-auto w-full max-w-xs rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-white",
        className,
      )}
    >
      <p
        className={cn(
          "flex items-center justify-center gap-1.5 text-xs font-semibold",
          GRADE_TONE[grade],
        )}
      >
        <Activity className="size-3.5" aria-hidden="true" />
        {GRADE_TEXT[grade]}
      </p>
      <dl className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-1 text-center text-[11px] leading-tight">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-white/60">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="sr-only" role="status" aria-live="polite">
        {metricsSummary(metrics)}
      </p>
    </section>
  );
}
