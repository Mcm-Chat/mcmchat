import { Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, CheckCircle2, FileImage } from "lucide-react";
import { rupiah, sisaHari, tanggal, waktuRelatif } from "@/lib/mcm/format";
import { ledgerRemaining } from "@/lib/mcm/store";
import type { LedgerEntry, LedgerStatus } from "@/lib/mcm/types";
import { StatusBadge, type Tone } from "./primitives";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export const STATUS_META: Record<LedgerStatus, { label: string; tone: Tone }> = {
  menunggu: { label: "Menunggu persetujuan", tone: "warning" },
  aktif: { label: "Aktif", tone: "primary" },
  sebagian: { label: "Sebagian dibayar", tone: "navy" },
  lunas: { label: "Lunas", tone: "success" },
  ditolak: { label: "Ditolak", tone: "danger" },
  disengketakan: { label: "Disengketakan", tone: "danger" },
  dibatalkan: { label: "Dibatalkan", tone: "neutral" },
};

export function LedgerSummaryCard({
  label,
  value,
  hint,
  tone = "primary",
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "primary" | "danger" | "warning" | "success" | undefined;
}) {
  const map = {
    primary: "bg-primary/10 text-primary",
    danger: "bg-destructive/10 text-destructive",
    warning: "bg-warning/20 text-warning-foreground dark:text-warning",
    success: "bg-success/12 text-success",
  };
  return (
    <div className="card-soft p-3">
      <span className={cn("inline-flex rounded-lg px-2 py-0.5 text-[10px] font-semibold", map[tone])}>{label}</span>
      <p className="mt-2 text-lg leading-tight font-bold">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LedgerCard({ entry }: { entry: LedgerEntry }) {
  const sisa = ledgerRemaining(entry);
  const persen = entry.amount > 0 ? Math.round((entry.paid / entry.amount) * 100) : 0;
  const hari = sisaHari(entry.dueDate);
  const meta = STATUS_META[entry.status];
  const piutang = entry.type === "piutang";
  return (
    <Link to="/ledger/$id" params={{ id: entry.id }} className="card-soft block p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            piutang ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {piutang ? <ArrowDownLeft className="size-5" /> : <ArrowUpRight className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold">{entry.counterpartName}</p>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{entry.note}</p>
          <p className="mt-1.5 text-base font-bold">{rupiah(sisa)}</p>
          <p className="text-[11px] text-muted-foreground">
            {piutang ? "Piutang saya" : "Saya berutang"} • dari {rupiah(entry.amount)}
          </p>
          {entry.paid > 0 && entry.status !== "lunas" && (
            <div className="mt-2 space-y-1">
              <Progress value={persen} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground">{persen}% terbayar</p>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <CalendarClock className="size-3.5" />
            {entry.status === "lunas" ? (
              <span className="text-success">Selesai {tanggal(entry.dueDate)}</span>
            ) : hari < 0 ? (
              <span className="font-medium text-destructive">Lewat {Math.abs(hari)} hari</span>
            ) : (
              <span>Jatuh tempo {tanggal(entry.dueDate)} • {hari} hari lagi</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function PaymentTimeline({ entry }: { entry: LedgerEntry }) {
  const items = [...entry.timeline].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <ol className="relative space-y-4 pl-6">
      <span className="absolute top-1 bottom-1 left-[7px] w-px bg-border" />
      {items.map((ev) => (
        <li key={ev.id} className="relative">
          <span className="absolute top-1 -left-[22px] size-3.5 rounded-full border-2 border-background bg-primary" />
          <p className="text-sm font-medium">{ev.label}</p>
          {ev.detail && <p className="text-xs text-muted-foreground">{ev.detail}</p>}
          <p className="text-[11px] text-muted-foreground">
            {ev.actor} • {waktuRelatif(ev.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function PaymentList({ entry }: { entry: LedgerEntry }) {
  if (entry.payments.length === 0)
    return <p className="text-sm text-muted-foreground">Belum ada pembayaran yang dicatat.</p>;
  return (
    <ul className="space-y-2">
      {entry.payments.map((p) => (
        <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <CheckCircle2 className="size-5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{rupiah(p.amount)}</p>
            <p className="text-xs text-muted-foreground">
              {p.method} • {tanggal(p.at)}
            </p>
            {p.note && <p className="text-[11px] text-muted-foreground">{p.note}</p>}
          </div>
          {p.proofName && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <FileImage className="size-3.5" /> bukti
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
