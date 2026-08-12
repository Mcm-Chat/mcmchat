import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, Plus, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { LedgerCard, LedgerSummaryCard } from "@/components/mcm/ledger-parts";
import { EmptyState } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rupiah } from "@/lib/mcm/format";
import { ledgerRemaining, ledgerTotals, uid, useMCM } from "@/lib/mcm/store";

export const Route = createFileRoute("/ledger/")({
  head: () => ({
    meta: [
      { title: "Catatan Utang — MCM" },
      { name: "description", content: "Pantau utang dan piutang dengan persetujuan dua pihak, cicilan, pengingat, dan ekspor CSV." },
      { property: "og:title", content: "Catatan Utang — MCM" },
      { property: "og:description", content: "Buku utang piutang cerdas untuk transaksi harian." },
    ],
  }),
  component: LedgerPage,
});

function LedgerPage() {
  const { state, update } = useMCM();
  const navigate = useNavigate();
  const [tab, setTab] = useState("semua");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("terbaru");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "piutang", counterpartId: "", amount: "", note: "", dueDate: "", reminder: true });

  const totals = ledgerTotals(state);

  const list = useMemo(() => {
    let arr = state.ledgers.filter((l) => (tab === "semua" ? true : tab === "piutang" ? l.type === "piutang" : tab === "utang" ? l.type === "utang" : l.status === "lunas"));
    if (tab !== "lunas") arr = arr.filter((l) => l.status !== "lunas" || tab === "semua");
    if (q.trim()) arr = arr.filter((l) => l.counterpartName.toLowerCase().includes(q.toLowerCase()) || l.note.toLowerCase().includes(q.toLowerCase()));
    return [...arr].sort((a, b) =>
      sort === "nominal" ? b.amount - a.amount : sort === "jatuhtempo" ? new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() : new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [state.ledgers, tab, q, sort]);

  const contacts = state.contacts.filter((c) => c.status === "contact");

  const create = () => {
    const amount = Number(form.amount);
    const contact = contacts.find((c) => c.id === form.counterpartId);
    if (!contact) { toast.error("Pilih kontak terlebih dahulu"); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Nominal harus lebih dari nol"); return; }
    if (form.note.trim().length < 3) { toast.error("Keterangan minimal 3 karakter"); return; }
    const id = uid("lg");
    update((d) => {
      d.ledgers.unshift({
        id,
        type: form.type as "piutang" | "utang",
        counterpartId: contact.id,
        counterpartName: contact.name,
        amount,
        paid: 0,
        date: new Date().toISOString(),
        dueDate: new Date(form.dueDate || Date.now() + 7 * 86400000).toISOString(),
        note: form.note.trim(),
        status: "menunggu",
        reminder: form.reminder,
        payments: [],
        timeline: [{ id: uid("ev"), at: new Date().toISOString(), actor: state.profile.name, label: "Catatan dibuat", detail: "Menunggu persetujuan" }],
      });
      return d;
    });
    setOpen(false);
    setForm({ type: "piutang", counterpartId: "", amount: "", note: "", dueDate: "", reminder: true });
    toast.success("Catatan dibuat dan menunggu persetujuan");
    navigate({ to: "/ledger/$id", params: { id } });
  };

  const exportCsv = () => {
    const rows = [
      ["Jenis", "Pihak", "Nominal", "Dibayar", "Sisa", "Status", "Jatuh tempo", "Keterangan"],
      ...state.ledgers.map((l) => [l.type, l.counterpartName, l.amount, l.paid, ledgerRemaining(l), l.status, l.dueDate.slice(0, 10), l.note.replace(/[",\n]/g, " ")]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "catatan-mcm.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV berhasil diunduh");
  };

  return (
    <AppShell
      header={
        <MobileHeader
          title="Catatan"
          subtitle="Utang & piutang dengan persetujuan dua pihak"
          actions={
            <Button variant="ghost" size="icon" aria-label="Ekspor CSV" onClick={exportCsv}>
              <Download className="size-5" />
            </Button>
          }
        >
          <div className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-2">
              <LedgerSummaryCard label="Piutang" value={rupiah(totals.piutang)} hint="Orang lain berutang ke Anda" tone="success" />
              <LedgerSummaryCard label="Utang" value={rupiah(totals.utang)} hint="Anda berutang ke orang lain" tone="danger" />
              <LedgerSummaryCard label="Jatuh tempo ≤7 hari" value={`${totals.jatuhTempo.length} catatan`} tone="warning" />
              <LedgerSummaryCard label="Lunas bulan ini" value={`${totals.lunasBulanIni.length} catatan`} tone="primary" />
            </div>
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} maxLength={40} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau catatan" className="h-10 rounded-xl pl-9" />
              </div>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-10 w-32 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="terbaru">Terbaru</SelectItem>
                  <SelectItem value="nominal">Nominal</SelectItem>
                  <SelectItem value="jatuhtempo">Jatuh tempo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Tabs value={tab} onValueChange={setTab} className="mt-3">
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="semua" className="flex-1 rounded-lg text-xs">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="piutang" className="flex-1 rounded-lg text-xs">
                  Piutang
                </TabsTrigger>
                <TabsTrigger value="utang" className="flex-1 rounded-lg text-xs">
                  Utang
                </TabsTrigger>
                <TabsTrigger value="lunas" className="flex-1 rounded-lg text-xs">
                  Lunas
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </MobileHeader>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Belum ada catatan"
          description="Buat catatan utang atau piutang, lalu kirim ke lawan transaksi untuk disetujui."
          action={
            <Button className="rounded-xl" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Catatan baru
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3 px-4 py-4 pb-28">
          {list.map((l) => (
            <li key={l.id}>
              <Link to="/ledger/$id" params={{ id: l.id }} className="block">
                <LedgerCard entry={l} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="pointer-events-none sticky bottom-4 flex justify-end px-4">
        <Button size="icon" className="pointer-events-auto size-14 rounded-2xl shadow-soft" aria-label="Catatan baru" onClick={() => setOpen(true)}>
          <Plus className="size-6" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Catatan baru</DialogTitle>
            <DialogDescription>Catatan berlaku setelah kedua pihak menyetujui.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Jenis</Label>
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="piutang">Piutang (mereka berutang)</SelectItem>
                  <SelectItem value="utang">Utang (saya berutang)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Pihak terkait</Label>
              <Select value={form.counterpartId} onValueChange={(v) => setForm((p) => ({ ...p, counterpartId: v }))}>
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue placeholder="Pilih kontak" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Nominal (Rp)</Label>
              <Input id="amount" inputMode="numeric" maxLength={12} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value.replace(/\D/g, "") }))} placeholder="500000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Keterangan</Label>
              <Input id="note" maxLength={80} value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Contoh: Pinjaman modal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due">Jatuh tempo</Label>
              <Input id="due" type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label htmlFor="reminder">Pengingat otomatis</Label>
              <Switch id="reminder" checked={form.reminder} onCheckedChange={(v) => setForm((p) => ({ ...p, reminder: v }))} />
            </div>
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Batal</Button>
            </DialogClose>
            <Button onClick={create}>Simpan & kirim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
