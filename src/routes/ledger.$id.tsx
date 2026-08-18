import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileText,
  MessageSquare,
  ShieldAlert,
  Sheet as SheetIcon,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import {
  EmptyState,
  LoadingSkeleton,
  ConfirmDialog,
  StatusBadge,
} from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rupiah, tanggal, waktuRelatif } from "@/lib/mcm/format";
import { supabase } from "@/integrations/supabase/client";
import { useRequireAuth } from "@/lib/api/guard";
import {
  getLedger,
  LEDGER_STATUS_LABEL,
  deleteLedgerPayment,
  recordPayment,
  remaining,
  updateStatus,
  type LedgerRow,
} from "@/lib/api/ledger";
import {
  optimisticDeletePayment,
  optimisticRecordPayment,
} from "@/lib/api/ledger-optimistic";
import { downloadPaymentsCsv, downloadPaymentsPdf } from "@/lib/ledger/export";
import {
  listExportHistory,
  recordExport,
  removeExport,
  type ExportHistoryEntry,
} from "@/lib/ledger/export-history";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { qk } from "@/lib/api/queries";
import { LedgerSkeleton } from "@/components/mcm/route-skeletons";

export const Route = createFileRoute("/ledger/$id")({
  head: () => ({
    meta: [
      { title: "Detail catatan — MCM" },
      {
        name: "description",
        content: "Detail utang piutang MCM: pembayaran, linimasa aktivitas, dan persetujuan.",
      },
      { property: "og:title", content: "Detail catatan — MCM" },
      { property: "og:description", content: "Riwayat pembayaran dan persetujuan catatan utang." },
    ],
  }),
  component: LedgerDetail,
  pendingComponent: () => <LedgerSkeleton nav={false} />,
});

function LedgerDetail() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.ledger(id),
    queryFn: () => getLedger(id),
    enabled: !!id,
  });

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`ledger-detail-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ledgers", filter: `id=eq.${id}` },
        () => {
          void qc.invalidateQueries({ queryKey: qk.ledger(id) });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ledger_payments", filter: `ledger_id=eq.${id}` },
        () => {
          void qc.invalidateQueries({ queryKey: qk.ledger(id) });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ledger_events", filter: `ledger_id=eq.${id}` },
        () => {
          void qc.invalidateQueries({ queryKey: qk.ledger(id) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, qc]);

  const [payOpen, setPayOpen] = useState(false);
  const [exports, setExports] = useState<ExportHistoryEntry[]>([]);
  useEffect(() => {
    setExports(listExportHistory(id));
  }, [id]);
  const [pay, setPay] = useState({ amount: "", method: "transfer", note: "" });
  const [delPayment, setDelPayment] = useState<null | { id: string; amount: number }>(null);
  const [confirm, setConfirm] = useState<null | {
    status: LedgerRow["status"];
    title: string;
    description: string;
    label: string;
    destructive?: boolean;
  }>(null);

  const ledger = data?.ledger;
  const isOwner = ledger?.owner_id === userId;
  const isCounterpart = ledger?.counterpart_user_id === userId;

  const sisa = useMemo(() => (ledger ? remaining(ledger) : 0), [ledger]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.ledger(id) }),
      qc.invalidateQueries({ queryKey: ["ledgers"] }),
    ]);

  const runStatus = async (status: LedgerRow["status"]) => {
    if (!ledger || !userId) return;
    try {
      await updateStatus(ledger.id, status, userId);
      toast.success(`Status diperbarui: ${LEDGER_STATUS_LABEL[status]}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui status");
    } finally {
      setConfirm(null);
    }
  };

  const submitPayment = async () => {
    if (!ledger) return;
    const amount = Number(pay.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal pembayaran tidak valid");
      return;
    }
    if (amount > sisa) {
      toast.error("Nominal melebihi sisa tagihan");
      return;
    }
    const rollback = optimisticRecordPayment(qc, ledger.id, {
      amount,
      method: pay.method,
      note: pay.note.trim() || null,
    });
    setPayOpen(false);
    setPay({ amount: "", method: "transfer", note: "" });
    try {
      const updated = await recordPayment(ledger.id, amount, pay.method, pay.note.trim());
      const sisaBaru = Math.max(0, Number(updated?.amount ?? 0) - Number(updated?.paid_amount ?? 0));
      toast.success(sisaBaru === 0 ? "Pembayaran tercatat — catatan lunas" : "Pembayaran tercatat");
      await refresh();
    } catch (err) {
      rollback();
      toast.error(err instanceof Error ? err.message : "Pembayaran gagal dicatat");
    }
  };

  if (loading || isLoading) {
    return (
      <AppShell nav={false} header={<MobileHeader back title="Detail catatan" />}>
        <LoadingSkeleton rows={5} />
      </AppShell>
    );
  }

  if (isError || !ledger) {
    return (
      <AppShell nav={false} header={<MobileHeader back title="Detail catatan" />}>
        <EmptyState
          icon={Wallet}
          title="Catatan tidak ditemukan"
          description="Catatan ini mungkin sudah dihapus atau Anda tidak memiliki akses."
          action={
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => void refetch()}>
                Coba lagi
              </Button>
              <Button asChild className="rounded-xl">
                <Link to="/finance">Kembali ke Keuangan</Link>
              </Button>
            </div>
          }
        />
      </AppShell>
    );
  }

  const canApprove = isCounterpart && ledger.status === "pending_approval";
  const canPay =
    (isOwner || isCounterpart) &&
    (ledger.status === "active" || ledger.status === "partially_paid");
  const canMarkPaid =
    (isOwner || isCounterpart) &&
    sisa === 0 &&
    ledger.status !== "paid" &&
    ledger.status !== "cancelled" &&
    ledger.status !== "rejected";
  const canDispute =
    (isOwner || isCounterpart) && !["disputed", "cancelled", "rejected"].includes(ledger.status);
  const canCancel = isOwner && !["cancelled", "paid"].includes(ledger.status);

  return (
    <AppShell
      nav={false}
      header={<MobileHeader back title="Detail catatan" subtitle={ledger.counterpart_name} />}
    >
      <div className="space-y-4 px-4 py-4 pb-10">
        <div className="card-soft space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-muted-foreground">
                {ledger.type === "receivable" ? "Piutang saya" : "Saya berutang"}
              </p>
              <p className="text-2xl font-bold">{rupiah(sisa)}</p>
              <p className="text-xs text-muted-foreground">
                dari total {rupiah(Number(ledger.amount))} • dibayar{" "}
                {rupiah(Number(ledger.paid_amount))}
              </p>
            </div>
            <StatusBadge
              tone={
                ledger.status === "paid"
                  ? "success"
                  : ledger.status === "rejected" || ledger.status === "disputed"
                    ? "danger"
                    : ledger.status === "pending_approval"
                      ? "warning"
                      : "primary"
              }
            >
              {LEDGER_STATUS_LABEL[ledger.status]}
            </StatusBadge>
          </div>
          {ledger.note && <p className="text-sm">{ledger.note}</p>}
          {ledger.due_date && (
            <p className="text-xs text-muted-foreground">Jatuh tempo {tanggal(ledger.due_date)}</p>
          )}
        </div>

        {canApprove && (
          <div className="card-soft space-y-2 p-4">
            <p className="text-sm font-semibold">Menunggu persetujuan Anda</p>
            <p className="text-xs text-muted-foreground">
              Catatan ini berlaku setelah Anda menyetujuinya.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => void runStatus("active")}>
                <CheckCircle2 className="size-4" /> Setujui
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-xl"
                onClick={() => void runStatus("rejected")}
              >
                <XCircle className="size-4" /> Tolak
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button className="rounded-xl" disabled={!canPay} onClick={() => setPayOpen(true)}>
            <Wallet className="size-4" /> Catat pembayaran
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={!canMarkPaid}
            onClick={() =>
              setConfirm({
                status: "paid",
                title: "Tandai lunas?",
                description: "Catatan ini akan ditandai lunas.",
                label: "Tandai lunas",
              })
            }
          >
            <CheckCircle2 className="size-4" /> Tandai lunas
          </Button>
        </div>

        <div className="card-soft p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Riwayat pembayaran</p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-xl"
                  disabled={data.payments.length === 0}
                >
                  <Download className="mr-1.5 size-4" />
                  Ekspor
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    try {
                      const res = downloadPaymentsCsv(ledger, data.payments);
                      setExports(
                        recordExport({
                          receipt: res.receipt,
                          ledgerId: ledger.id,
                          ledgerName: ledger.counterpart_name ?? "Catatan",
                          format: "csv",
                          fileName: res.fileName,
                          at: new Date().toISOString(),
                        }),
                      );
                      toast.success("Riwayat pembayaran diekspor ke CSV");
                    } catch {
                      toast.error("Gagal mengekspor CSV");
                    }
                  }}
                >
                  <SheetIcon className="mr-2 size-4" />
                  Simpan CSV
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void (async () => {
                      try {
                        const res = await downloadPaymentsPdf(ledger, data.payments);
                        setExports(
                          recordExport({
                            receipt: res.receipt,
                            ledgerId: ledger.id,
                            ledgerName: ledger.counterpart_name ?? "Catatan",
                            format: "pdf",
                            fileName: res.fileName,
                            at: new Date().toISOString(),
                          }),
                        );
                        toast.success("Bukti pembayaran diekspor ke PDF");
                      } catch {
                        toast.error("Gagal mengekspor PDF");
                      }
                    })();
                  }}
                >
                  <FileText className="mr-2 size-4" />
                  Simpan PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {exports.length > 0 ? (
            <div className="mb-3 rounded-xl border border-border p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Unduhan terbaru (tersimpan di perangkat ini)
              </p>
              <ul className="space-y-2">
                {exports.slice(0, 5).map((e) => (
                  <li key={e.receipt} className="flex items-center gap-2">
                    {e.format === "pdf" ? (
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <SheetIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{e.receipt}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {e.format.toUpperCase()} • {tanggal(e.at)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-lg px-2 text-xs"
                      onClick={() => {
                        void (async () => {
                          try {
                            if (e.format === "pdf") {
                              await downloadPaymentsPdf(ledger, data.payments, e.receipt);
                            } else {
                              downloadPaymentsCsv(ledger, data.payments, e.receipt);
                            }
                            toast.success("Berkas diunduh ulang");
                          } catch {
                            toast.error("Gagal mengunduh ulang");
                          }
                        })();
                      }}
                    >
                      <Download className="mr-1 size-3.5" /> Unduh
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Hapus riwayat ekspor ${e.receipt}`}
                      className="size-8 rounded-lg text-muted-foreground"
                      onClick={() => {
                        removeExport(e.receipt);
                        setExports(listExportHistory(ledger.id));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada pembayaran yang dicatat.</p>
          ) : (
            <ul className="space-y-2">
              {data.payments.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                >
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{rupiah(Number(p.amount))}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.method} • {tanggal(p.paid_at)}
                    </p>
                    {p.note && <p className="text-[11px] text-muted-foreground">{p.note}</p>}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 rounded-xl text-destructive"
                    aria-label={`Hapus pembayaran ${rupiah(Number(p.amount))}`}
                    onClick={() => setDelPayment({ id: p.id, amount: Number(p.amount) })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-soft p-4">
          <p className="mb-2 text-sm font-semibold">Linimasa aktivitas</p>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
          ) : (
            <ol className="relative space-y-4 pl-6">
              <span className="absolute top-1 bottom-1 left-[7px] w-px bg-border" />
              {[...data.events].reverse().map((ev) => (
                <li key={ev.id} className="relative">
                  <span className="absolute top-1 -left-[22px] size-3.5 rounded-full border-2 border-background bg-primary" />
                  <p className="text-sm font-medium">{ev.label}</p>
                  {ev.detail && <p className="text-xs text-muted-foreground">{ev.detail}</p>}
                  <p className="text-[11px] text-muted-foreground">{waktuRelatif(ev.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ledger.conversation_id && (
            <Button variant="outline" className="rounded-xl" asChild>
              <Link to="/chat/$id" params={{ id: ledger.conversation_id }}>
                <MessageSquare className="size-4" /> Buka chat
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            className="rounded-xl text-destructive"
            disabled={!canDispute}
            onClick={() =>
              setConfirm({
                status: "disputed",
                title: "Sengketakan catatan?",
                description:
                  "Catatan akan ditandai disengketakan hingga kedua pihak menyelesaikannya.",
                label: "Sengketakan",
                destructive: true,
              })
            }
          >
            <ShieldAlert className="size-4" /> Sengketakan
          </Button>
        </div>

        {canCancel && (
          <Button
            variant="ghost"
            className="w-full rounded-xl text-destructive"
            onClick={() =>
              setConfirm({
                status: "cancelled",
                title: "Batalkan catatan?",
                description: "Catatan yang dibatalkan tidak bisa diaktifkan kembali.",
                label: "Batalkan",
                destructive: true,
              })
            }
          >
            <XCircle className="size-4" /> Batalkan catatan
          </Button>
        )}
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Catat pembayaran</DialogTitle>
            <DialogDescription>Sisa tagihan {rupiah(sisa)}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Nominal (Rp)</Label>
              <Input
                id="pay-amount"
                inputMode="numeric"
                maxLength={12}
                value={pay.amount}
                onChange={(e) =>
                  setPay((p) => ({ ...p, amount: e.target.value.replace(/\D/g, "") }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Metode</Label>
              <Select
                value={pay.method}
                onValueChange={(v) => setPay((p) => ({ ...p, method: v }))}
              >
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transfer">Transfer bank</SelectItem>
                  <SelectItem value="cash">Tunai</SelectItem>
                  <SelectItem value="ewallet">E-wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-note">Catatan</Label>
              <Input
                id="pay-note"
                maxLength={80}
                value={pay.note}
                onChange={(e) => setPay((p) => ({ ...p, note: e.target.value }))}
                placeholder="Opsional"
              />
            </div>
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Batal</Button>
            </DialogClose>
            <Button onClick={() => void submitPayment()}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.label ?? "Lanjutkan"}
        destructive={confirm?.destructive}
        onConfirm={() => confirm && void runStatus(confirm.status)}
      />

      <ConfirmDialog
        open={!!delPayment}
        onOpenChange={(v) => !v && setDelPayment(null)}
        title="Hapus pembayaran?"
        description={`Pembayaran ${rupiah(delPayment?.amount ?? 0)} akan dihapus dan sisa tagihan dihitung ulang.`}
        confirmLabel="Hapus"
        destructive
        onConfirm={() => {
          const target = delPayment;
          if (!target) return;
          void (async () => {
            const rollback = optimisticDeletePayment(qc, id, target.id);
            setDelPayment(null);
            try {
              const updated = await deleteLedgerPayment(target.id);
              const sisaBaru = Math.max(
                0,
                Number(updated?.amount ?? 0) - Number(updated?.paid_amount ?? 0),
              );
              toast.success(
                sisaBaru > 0 ? "Pembayaran dihapus — sisa tagihan diperbarui" : "Pembayaran dihapus",
              );
              await refresh();
            } catch (err) {
              rollback();
              toast.error(err instanceof Error ? err.message : "Gagal menghapus pembayaran");
            }
          })();
        }}
      />
    </AppShell>
  );
}
