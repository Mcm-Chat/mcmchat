import { useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { rupiah } from "@/lib/mcm/format";
import { sendPrepareSale } from "@/lib/prepare.functions";
import { useServerFn } from "@tanstack/react-start";
import type { PrepTask } from "@/lib/prepare.server.types";

type Method = "cash" | "transfer" | "dp" | "credit";

const METHODS: Array<{ value: Method; label: string }> = [
  { value: "cash", label: "Tunai" },
  { value: "transfer", label: "Transfer" },
  { value: "dp", label: "DP / uang muka" },
  { value: "credit", label: "Kredit / tempo" },
];

const num = (v: string) => {
  const n = Number(v.replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Dialog penjualan untuk pegawai penyiapan: isi harga per item, metode bayar,
 * lalu satu tombol kirim menyelesaikan tugas, mencatat penjualan + hutang, dan
 * mengirim satu bubble chat (foto + link lokasi + status hutang).
 */
export function PrepareSaleDialog({
  token,
  task,
  open,
  onOpenChange,
  onSent,
}: {
  token: string;
  task: PrepTask;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSent: () => void;
}) {
  const send = useServerFn(sendPrepareSale);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState("");
  const [extraFee, setExtraFee] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [paid, setPaid] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => `prep-${crypto.randomUUID()}`);

  const lines = task.items.map((i) => ({
    item: i,
    qty: i.actual_qty_base ?? i.requested_qty_base,
    price: num(prices[i.id] ?? ""),
  }));
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + l.price * l.qty, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(prices), task.items.length],
  );
  const total = Math.max(0, subtotal - num(discount) + num(extraFee));
  const paidNow = method === "cash" || method === "transfer" ? total : num(paid);
  const outstanding = Math.max(0, total - paidNow);
  const needDue = method === "dp" || method === "credit";

  const submit = async () => {
    if (total <= 0) {
      toast.error("Isi harga jual minimal satu item.");
      return;
    }
    if (method === "dp" && paidNow <= 0) {
      toast.error("DP harus lebih dari nol.");
      return;
    }
    if (needDue && !dueDate) {
      toast.error("Tanggal jatuh tempo wajib untuk DP atau kredit.");
      return;
    }
    setBusy(true);
    try {
      const res = await send({
        data: {
          token,
          idempotencyKey: key,
          prices: task.items.map((i) => ({
            itemId: i.id,
            price: num(prices[i.id] ?? ""),
            discount: 0,
          })),
          discount: num(discount),
          extraFee: num(extraFee),
          paymentMethod: method,
          paidAmount: paidNow,
          dueDate: needDue ? dueDate : null,
          note,
        },
      });
      toast.success(
        res.already
          ? "Penjualan ini sudah tercatat sebelumnya"
          : `Terkirim • ${res.number} • sisa hutang ${rupiah(res.outstanding)}`,
      );
      onOpenChange(false);
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim penjualan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Dialog penjualan</DialogTitle>
          <DialogDescription>
            Isi harga jual, lalu kirim. Hasil penyiapan, lokasi, dan catatan hutang dikirim sebagai
            satu pesan ke chat pelanggan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.item.id} className="space-y-1.5">
              <Label htmlFor={`price-${l.item.id}`}>
                {l.item.product_name} — {l.item.variant_name} · {l.qty} {l.item.base_unit}
              </Label>
              <Input
                id={`price-${l.item.id}`}
                inputMode="numeric"
                placeholder={`Harga per ${l.item.base_unit}`}
                value={prices[l.item.id] ?? ""}
                onChange={(e) => setPrices((p) => ({ ...p, [l.item.id]: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Subtotal {rupiah(l.price * l.qty)}
              </p>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="prep-disc">Diskon</Label>
              <Input
                id="prep-disc"
                inputMode="numeric"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prep-fee">Ongkos / biaya</Label>
              <Input
                id="prep-fee"
                inputMode="numeric"
                value={extraFee}
                onChange={(e) => setExtraFee(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Metode pembayaran</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as Method)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needDue && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="prep-paid">Dibayar</Label>
                <Input
                  id="prep-paid"
                  inputMode="numeric"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prep-due">Jatuh tempo</Label>
                <Input
                  id="prep-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="prep-note">Catatan</Label>
            <Textarea
              id="prep-note"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan untuk pelanggan (opsional)"
            />
          </div>

          <div className="rounded-xl bg-muted p-3 text-sm">
            <div className="flex justify-between">
              <span>Total</span>
              <span className="font-semibold">{rupiah(total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Dibayar</span>
              <span>{rupiah(paidNow)}</span>
            </div>
            <div className="flex justify-between text-destructive">
              <span>Sisa hutang</span>
              <span className="font-semibold">{rupiah(outstanding)}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Kirim ke chat pelanggan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
