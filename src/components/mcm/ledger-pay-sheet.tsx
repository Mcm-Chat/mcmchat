import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { recordPayment, remaining, type LedgerRow } from "@/lib/api/ledger";
import { optimisticRecordPayment } from "@/lib/api/ledger-optimistic";
import { qk } from "@/lib/api/queries";
import { rupiah } from "@/lib/mcm/format";

/** Status yang masih boleh menerima pembayaran. */
export const PAYABLE_STATUSES: LedgerRow["status"][] = ["active", "partially_paid", "disputed"];

export const canPayLedger = (ledger: LedgerRow) =>
  PAYABLE_STATUSES.includes(ledger.status) && remaining(ledger) > 0;

const todayInput = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

/** Ubah tanggal input (lokal) jadi ISO; pakai jam sekarang bila tanggalnya hari ini. */
function toIso(dateStr: string) {
  if (!dateStr) return new Date().toISOString();
  if (dateStr === todayInput()) return new Date().toISOString();
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Bottom sheet pembayaran cepat: sisa tagihan, nominal (default sisa penuh),
 * tombol cepat lunasi/setengah, catatan & tanggal opsional.
 */
export function LedgerPaySheet({
  ledger,
  open,
  onOpenChange,
  actorId,
}: {
  ledger: LedgerRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actorId?: string;
}) {
  const qc = useQueryClient();
  const sisa = remaining(ledger);
  const [amount, setAmount] = useState(String(Math.round(sisa)));
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayInput());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(String(Math.round(remaining(ledger))));
      setNote("");
      setDate(todayInput());
    }
  }, [open, ledger]);

  const value = Number(amount || 0);

  const submit = async () => {
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Nominal harus lebih dari nol");
      return;
    }
    if (value > sisa) {
      toast.error("Nominal melebihi sisa tagihan");
      return;
    }
    setSaving(true);
    const paidAt = toIso(date);
    const rollback = optimisticRecordPayment(qc, ledger.id, {
      amount: value,
      method: "cash",
      note: note.trim() || null,
      paidAt,
    });
    onOpenChange(false);
    try {
      const updated = await recordPayment(ledger.id, value, "cash", note.trim(), paidAt);
      const sisaBaru = Math.max(0, Number(updated?.amount ?? 0) - Number(updated?.paid_amount ?? 0));
      toast.success(sisaBaru === 0 ? "Pembayaran dicatat — catatan lunas" : "Pembayaran dicatat");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ledgers"] }),
        qc.invalidateQueries({ queryKey: qk.ledger(ledger.id) }),
      ]);
    } catch (err) {
      rollback();
      toast.error(err instanceof Error ? err.message : "Pembayaran gagal dicatat");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => (saving ? undefined : onOpenChange(v))}>
      <SheetContent side="bottom" className="rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <SheetHeader className="text-left">
          <SheetTitle>Bayar {ledger.counterpart_name}</SheetTitle>
          <SheetDescription>
            Sisa tagihan <span className="font-semibold text-foreground">{rupiah(sisa)}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-sheet-amount">Nominal bayar</Label>
            <Input
              id="pay-sheet-amount"
              inputMode="numeric"
              maxLength={12}
              className="h-12 text-lg font-semibold"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
            <p className="text-[11px] text-muted-foreground">{rupiah(value)}</p>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-10 flex-1 rounded-xl text-xs"
              onClick={() => setAmount(String(Math.round(sisa)))}
            >
              Lunasi semua
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-10 flex-1 rounded-xl text-xs"
              onClick={() => setAmount(String(Math.max(1, Math.round(sisa / 2))))}
            >
              Setengah
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-sheet-date">Tanggal</Label>
              <Input
                id="pay-sheet-date"
                type="date"
                className="h-11"
                value={date}
                max={todayInput()}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-sheet-note">Catatan (opsional)</Label>
              <Input
                id="pay-sheet-note"
                className="h-11"
                placeholder="mis. transfer BCA"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <Button className="h-12 w-full rounded-2xl" disabled={saving} onClick={() => void submit()}>
            <Wallet className="size-4" />
            {saving ? "Menyimpan…" : `Bayar ${rupiah(value)}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
