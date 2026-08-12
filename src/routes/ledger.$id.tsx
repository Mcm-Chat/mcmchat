import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BellRing, CheckCircle2, MessageSquare, ShieldAlert, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { LedgerCard, PaymentList, PaymentTimeline } from "@/components/mcm/ledger-parts";
import { ProtoNote } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rupiah } from "@/lib/mcm/format";
import { applyPayment, ledgerRemaining, uid, useMCM } from "@/lib/mcm/store";

export const Route = createFileRoute("/ledger/$id")({
  head: () => ({
    meta: [
      { title: "Detail catatan — MCM" },
      { name: "description", content: "Detail utang piutang MCM: cicilan, bukti bayar, linimasa aktivitas, dan pengingat." },
      { property: "og:title", content: "Detail catatan — MCM" },
      { property: "og:description", content: "Riwayat cicilan dan persetujuan catatan utang." },
    ],
  }),
  component: LedgerDetail,
});

function LedgerDetail() {
  const { id } = Route.useParams();
  const { state, update } = useMCM();
  const entry = state.ledgers.find((l) => l.id === id);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "Transfer bank", note: "" });

  if (!entry) {
    return (
      <AppShell nav={false} header={<MobileHeader back title="Catatan tidak ditemukan" />}>
        <div className="px-6 py-16 text-center text-sm text-muted-foreground">
          Catatan ini sudah dihapus.
          <div className="mt-4">
            <Button asChild className="rounded-xl">
              <Link to="/ledger">Kembali ke catatan</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const addEvent = (label: string, detail?: string) => ({
    id: uid("ev"),
    at: new Date().toISOString(),
    actor: state.profile.name,
    label,
    ...(detail ? { detail } : {}),
  });

  const setStatus = (status: typeof entry.status, label: string) => {
    update((d) => {
      const l = d.ledgers.find((x) => x.id === id)!;
      l.status = status;
      l.timeline.push(addEvent(label));
      return d;
    });
    toast.success(label);
  };

  const submitPayment = () => {
    const amount = Number(pay.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Nominal cicilan tidak valid"); return; }
    if (amount > ledgerRemaining(entry)) { toast.error("Nominal melebihi sisa tagihan"); return; }
    update((d) => {
      const idx = d.ledgers.findIndex((x) => x.id === id);
      const updated = applyPayment(d.ledgers[idx]!, {
        id: uid("pm"),
        amount,
        at: new Date().toISOString(),
        method: pay.method,
        ...(pay.note.trim() ? { note: pay.note.trim() } : {}),
      });
      updated.timeline = [...updated.timeline, addEvent("Pembayaran dicatat", `${rupiah(amount)} via ${pay.method}`)];
      d.ledgers[idx] = updated;
      return d;
    });
    setPayOpen(false);
    setPay({ amount: "", method: "Transfer bank", note: "" });
    toast.success("Pembayaran tercatat");
  };

  return (
    <AppShell nav={false} header={<MobileHeader back title="Detail catatan" subtitle={entry.counterpartName} />}>
      <div className="space-y-4 px-4 py-4">
        <LedgerCard entry={entry} />

        {entry.status === "menunggu" && (
          <div className="card-soft space-y-2 p-4">
            <p className="text-sm font-semibold">Menunggu persetujuan</p>
            <p className="text-xs text-muted-foreground">Catatan berlaku setelah kedua pihak setuju.</p>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl" onClick={() => setStatus("aktif", "Catatan disetujui")}>
                <CheckCircle2 className="size-4" /> Setujui
              </Button>
              <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setStatus("ditolak", "Catatan ditolak")}>
                <XCircle className="size-4" /> Tolak
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button className="rounded-xl" onClick={() => setPayOpen(true)} disabled={entry.status === "lunas" || entry.status === "ditolak"}>
            <Wallet className="size-4" /> Catat cicilan
          </Button>
          <Button variant="outline" className="rounded-xl" onClick={() => toast.success("Pengingat dikirim ke " + entry.counterpartName)}>
            <BellRing className="size-4" /> Kirim pengingat
          </Button>
        </div>

        <div className="card-soft flex items-center justify-between p-3">
          <Label htmlFor="rem">Pengingat otomatis</Label>
          <Switch
            id="rem"
            checked={entry.reminder}
            onCheckedChange={(v) =>
              update((d) => {
                const l = d.ledgers.find((x) => x.id === id)!;
                l.reminder = v;
                return d;
              })
            }
          />
        </div>

        <div className="card-soft p-4">
          <p className="mb-2 text-sm font-semibold">Riwayat pembayaran</p>
          <PaymentList entry={entry} />
        </div>

        <div className="card-soft p-4">
          <p className="mb-2 text-sm font-semibold">Linimasa aktivitas</p>
          <PaymentTimeline entry={entry} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {entry.createdFromChatId && (
            <Button variant="outline" className="rounded-xl" asChild>
              <Link to="/chat/$id" params={{ id: entry.createdFromChatId }}>
                <MessageSquare className="size-4" /> Buka chat
              </Link>
            </Button>
          )}
          <Button variant="outline" className="rounded-xl text-destructive" onClick={() => setStatus("disengketakan", "Catatan disengketakan")}>
            <ShieldAlert className="size-4" /> Sengketakan
          </Button>
        </div>

        <ProtoNote>Kesepakatan dicatat lokal di perangkat. Versi produksi membutuhkan sinkronisasi server agar kedua pihak melihat status sama.</ProtoNote>
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Catat pembayaran</DialogTitle>
            <DialogDescription>Sisa tagihan {rupiah(ledgerRemaining(entry))}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Nominal (Rp)</Label>
              <Input id="pay-amount" inputMode="numeric" maxLength={12} value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value.replace(/\D/g, "") }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Metode</Label>
              <Select value={pay.method} onValueChange={(v) => setPay((p) => ({ ...p, method: v }))}>
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Transfer bank">Transfer bank</SelectItem>
                  <SelectItem value="Tunai">Tunai</SelectItem>
                  <SelectItem value="E-wallet">E-wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-note">Catatan</Label>
              <Input id="pay-note" maxLength={80} value={pay.note} onChange={(e) => setPay((p) => ({ ...p, note: e.target.value }))} placeholder="Opsional" />
            </div>
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Batal</Button>
            </DialogClose>
            <Button onClick={submitPayment}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
