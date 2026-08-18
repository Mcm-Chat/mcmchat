import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { increaseLedgerAmount, recordPayment, remaining, type LedgerRow } from "@/lib/api/ledger";
import { qk } from "@/lib/api/queries";
import { rupiah } from "@/lib/mcm/format";

type Mode = "add" | "reduce";

/**
 * Tombol cepat menambah nominal atau mencatat pembayaran (mengurangi) langsung
 * dari daftar utang/piutang tanpa masuk halaman detail.
 */
export function LedgerQuickAdjust({ ledger, actorId }: { ledger: LedgerRow; actorId?: string }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const sisa = remaining(ledger);

  useEffect(() => {
    if (mode) {
      setAmount("");
      setNote("");
    }
  }, [mode]);

  const locked = ["cancelled", "rejected", "pending_approval"].includes(ledger.status);
  if (locked || !actorId) return null;

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Nominal harus lebih dari nol");
      return;
    }
    if (mode === "reduce" && value > sisa) {
      toast.error("Nominal melebihi sisa tagihan");
      return;
    }
    setSaving(true);
    try {
      if (mode === "add") {
        await increaseLedgerAmount(ledger, value, actorId, note);
        toast.success("Nominal ditambah");
      } else {
        await recordPayment(ledger.id, value, "cash", note.trim());
        toast.success("Pembayaran tercatat");
      }
      await qc.invalidateQueries({ queryKey: qk.ledgers(actorId) });
      void qc.invalidateQueries({ queryKey: qk.ledger(ledger.id) });
      setMode(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const quick = [10000, 50000, 100000];

  return (
    <>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 flex-1 rounded-xl text-xs"
          onClick={() => setMode("add")}
        >
          <Plus className="size-3.5" /> Tambah
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-8 flex-1 rounded-xl text-xs"
          disabled={sisa <= 0}
          onClick={() => setMode("reduce")}
        >
          <Minus className="size-3.5" /> Kurangi
        </Button>
      </div>

      <Dialog open={mode !== null} onOpenChange={(v) => (saving ? undefined : setMode(v ? mode : null))}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "add" ? "Tambah nominal" : "Kurangi (catat pembayaran)"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {ledger.counterpart_name} • sisa {rupiah(sisa)}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="qa-amount">Nominal</Label>
              <Input
                id="qa-amount"
                inputMode="numeric"
                className="h-11"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              />
              <div className="flex gap-2 pt-1">
                {quick.map((v) => (
                  <Button
                    key={v}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 rounded-xl text-[11px]"
                    onClick={() => setAmount(String(v))}
                  >
                    +{rupiah(v)}
                  </Button>
                ))}
              </div>
              {mode === "reduce" && sisa > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-full rounded-xl text-[11px]"
                  onClick={() => setAmount(String(sisa))}
                >
                  Lunasi sisa {rupiah(sisa)}
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-note">Catatan (opsional)</Label>
              <Input
                id="qa-note"
                className="h-11"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              className="h-11 w-full rounded-xl"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
