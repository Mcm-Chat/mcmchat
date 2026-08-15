import { Link } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, MessageSquare } from "lucide-react";
import { labelHari, rupiah, tanggal } from "@/lib/mcm/format";
import { LEDGER_STATUS_LABEL, remaining, type LedgerRow } from "@/lib/api/ledger";
import { PAYMENT_LABEL, type OrderRow, type SalesRecordRow } from "@/lib/api/sales";
import { salesPayload } from "@/lib/api/finance";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Tone } from "./primitives";
import { cn } from "@/lib/utils";

export function FinanceSummaryCard({
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
    primary: "bg-primary",
    danger: "bg-destructive",
    warning: "bg-warning",
    success: "bg-success",
  };
  return (
    <div className="card-soft p-3.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 shrink-0 rounded-full", map[tone])} aria-hidden />
        <span className="truncate text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          {label}
        </span>
      </div>
      <p className="mt-1.5 text-lg leading-tight font-bold tracking-[-0.02em]">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const LEDGER_TONE: Record<LedgerRow["status"], Tone> = {
  pending_approval: "warning",
  active: "primary",
  partially_paid: "navy",
  paid: "success",
  rejected: "danger",
  disputed: "danger",
  cancelled: "neutral",
};

export function LedgerListItem({ ledger }: { ledger: LedgerRow }) {
  const sisa = remaining(ledger);
  const receivable = ledger.type === "receivable";
  return (
    <div className="card-soft p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            receivable ? "bg-success/12 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {receivable ? <ArrowDownLeft className="size-5" /> : <ArrowUpRight className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold">{ledger.counterpart_name}</p>
            <StatusBadge tone={LEDGER_TONE[ledger.status]}>
              {LEDGER_STATUS_LABEL[ledger.status]}
            </StatusBadge>
          </div>
          {ledger.note && <p className="truncate text-xs text-muted-foreground">{ledger.note}</p>}
          <p className="mt-1.5 text-base font-bold">{rupiah(sisa)}</p>
          <p className="text-[11px] text-muted-foreground">
            {receivable ? "Piutang saya" : "Saya berutang"} • dari {rupiah(Number(ledger.amount))} •
            dibayar {rupiah(Number(ledger.paid_amount))}
          </p>
          {ledger.due_date && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <CalendarClock className="size-3.5" />
              <span>Jatuh tempo {tanggal(ledger.due_date)}</span>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <Button asChild size="sm" variant="outline" className="h-8 flex-1 rounded-xl text-xs">
              <Link to="/ledger/$id" params={{ id: ledger.id }}>
                Lihat detail
              </Link>
            </Button>
            {ledger.conversation_id && (
              <Button asChild size="sm" variant="ghost" className="h-8 flex-1 rounded-xl text-xs">
                <Link to="/chat/$id" params={{ id: ledger.conversation_id }}>
                  <MessageSquare className="size-3.5" /> Buka chat
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SalesListItem({ sale, onOpen }: { sale: SalesRecordRow; onOpen: () => void }) {
  const payload = salesPayload(sale);
  const outstanding = Number(sale.total) - Number(sale.paid_amount);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-soft block w-full p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{payload.number}</p>
          <p className="truncate text-xs text-muted-foreground">{payload.customerName}</p>
        </div>
        <StatusBadge tone={outstanding > 0 ? "warning" : "success"}>
          {outstanding > 0 ? "Belum lunas" : "Lunas"}
        </StatusBadge>
      </div>
      <p className="mt-1.5 text-base font-bold">{rupiah(Number(sale.total))}</p>
      <p className="text-[11px] text-muted-foreground">
        {PAYMENT_LABEL[sale.payment_method]} • dibayar {rupiah(Number(sale.paid_amount))} •{" "}
        {tanggal(sale.created_at)}
      </p>
    </button>
  );
}

export const ORDER_STATUS_LABEL: Record<OrderRow["status"], string> = {
  new: "Baru",
  processing: "Diproses",
  shipped: "Dikirim",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export const ORDER_STATUS_TONE: Record<OrderRow["status"], Tone> = {
  new: "warning",
  processing: "primary",
  shipped: "navy",
  completed: "success",
  cancelled: "danger",
};

export function OrderListItem({
  order,
  onChangeStatus,
}: {
  order: OrderRow;
  onChangeStatus: (status: OrderRow["status"]) => void;
}) {
  const NEXT: Partial<Record<OrderRow["status"], OrderRow["status"]>> = {
    new: "processing",
    processing: "shipped",
    shipped: "completed",
  };
  const next = NEXT[order.status];
  return (
    <div className="card-soft p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{order.number}</p>
          <p className="truncate text-xs text-muted-foreground">{tanggal(order.created_at)}</p>
        </div>
        <StatusBadge tone={ORDER_STATUS_TONE[order.status]}>
          {ORDER_STATUS_LABEL[order.status]}
        </StatusBadge>
      </div>
      <p className="mt-1.5 text-base font-bold">{rupiah(Number(order.total))}</p>
      <div className="mt-2 flex gap-2">
        {next && (
          <Button
            size="sm"
            className="h-8 flex-1 rounded-xl text-xs"
            onClick={() => onChangeStatus(next)}
          >
            Tandai {ORDER_STATUS_LABEL[next]}
          </Button>
        )}
        {order.status !== "cancelled" && order.status !== "completed" && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 rounded-xl text-xs text-destructive"
            onClick={() => onChangeStatus("cancelled")}
          >
            Batalkan
          </Button>
        )}
      </div>
    </div>
  );
}

export function DailySummaryRow({ row }: { row: import("@/lib/api/ledger-summary").DailySummary }) {
  return (
    <div className="card-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{labelHari(row.iso)}</p>
        <span className="text-[11px] text-muted-foreground">{row.count} catatan</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground">Piutang baru</p>
          <p className="text-xs font-bold text-success">{rupiah(row.newReceivable)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Utang baru</p>
          <p className="text-xs font-bold text-destructive">{rupiah(row.newPayable)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Dibayar</p>
          <p className="text-xs font-bold">{rupiah(row.paid)}</p>
        </div>
      </div>
    </div>
  );
}

export function ContactSummaryRow({
  row,
}: {
  row: import("@/lib/api/ledger-summary").ContactSummary;
}) {
  const positif = row.net >= 0;
  return (
    <div className="card-soft p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {row.openCount} catatan terbuka
            {row.overdueCount > 0 ? ` • ${row.overdueCount} lewat tempo` : ""}
          </p>
        </div>
        <StatusBadge tone={row.net === 0 ? "neutral" : positif ? "success" : "danger"}>
          {row.net === 0 ? "Seimbang" : positif ? "Menerima" : "Membayar"}
        </StatusBadge>
      </div>
      <p
        className={cn("mt-1.5 text-base font-bold", positif ? "text-success" : "text-destructive")}
      >
        {rupiah(Math.abs(row.net))}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Piutang {rupiah(row.receivable)} • Utang {rupiah(row.payable)} • terakhir{" "}
        {tanggal(row.lastAt)}
      </p>
    </div>
  );
}
