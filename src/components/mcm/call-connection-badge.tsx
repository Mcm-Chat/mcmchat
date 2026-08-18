import { cn } from "@/lib/utils";
import { callConnectionStatus, type CallConnectionInput } from "@/lib/calls/connection-status";

const TONE: Record<string, string> = {
  live: "bg-success/20 text-success-foreground ring-success/40",
  pending: "bg-on-dark-surface text-navy-foreground ring-on-dark-border",
  warn: "bg-warning/20 text-navy-foreground ring-warning/50",
  down: "bg-destructive/20 text-navy-foreground ring-destructive/50",
};

const DOT: Record<string, string> = {
  live: "bg-success",
  pending: "bg-on-dark/80 animate-pulse",
  warn: "bg-warning",
  down: "bg-destructive",
};

/** Chip status koneksi yang terlihat, dengan alasan bila kontrol belum aktif. */
export function CallConnectionBadge({
  className,
  ...input
}: CallConnectionInput & { className?: string }) {
  const status = callConnectionStatus(input);
  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1",
          TONE[status.tone],
        )}
      >
        <span aria-hidden="true" className={cn("size-2 rounded-full", DOT[status.tone])} />
        {status.label}
      </span>
      {status.hint && (
        <p className="max-w-[18rem] text-center text-[11px] text-navy-foreground/70">
          {status.hint}
        </p>
      )}
    </div>
  );
}
