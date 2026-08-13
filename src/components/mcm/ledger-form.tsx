import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createLedger, type LedgerRow } from "@/lib/api/ledger";
import { useContacts, qk } from "@/lib/api/queries";

export type LedgerFormPreset = {
  counterpartUserId: string | null;
  counterpartName: string;
  conversationId?: string | null;
};

const empty = { type: "receivable", amount: "", dueDate: "", note: "", reminder: true, contact: "" };

/**
 * Satu-satunya form pembuatan catatan utang/piutang. Dipakai dari menu
 * Keuangan maupun dari ruang chat sehingga logikanya tidak terduplikasi.
 */
export function LedgerFormDialog({
  open,
  onOpenChange,
  ownerId,
  preset,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ownerId: string;
  preset?: LedgerFormPreset | undefined;
  onCreated?: ((entry: LedgerRow) => void | Promise<void>) | undefined;
}) {
  const qc = useQueryClient();
  const { data: contacts } = useContacts(preset ? undefined : ownerId);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(empty);
  }, [open]);

  const submit = async () => {
    if (saving) return; // anti double-submit
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal harus lebih dari nol");
      return;
    }
    const picked = (contacts ?? []).find((c) => c.contact_id === form.contact);
    const counterpartUserId = preset ? preset.counterpartUserId : (picked?.contact_id ?? null);
    const counterpartName = preset ? preset.counterpartName : (picked?.profile.display_name ?? "");
    if (!counterpartName) {
      toast.error("Pilih lawan transaksi dari kontak");
      return;
    }
    setSaving(true);
    try {
      const entry = await createLedger({
        ownerId,
        counterpartUserId,
        counterpartName,
        type: form.type as LedgerRow["type"],
        amount,
        dueDate: form.dueDate || null,
        note: form.note,
        reminder: form.reminder,
        conversationId: preset?.conversationId ?? null,
        // Bila melibatkan pengguna lain, catatan menunggu persetujuan.
        status: counterpartUserId ? "pending_approval" : "active",
      });
      await qc.invalidateQueries({ queryKey: qk.ledgers(ownerId) });
      onOpenChange(false);
      await onCreated?.(entry);
      toast.success(counterpartUserId ? "Catatan dikirim untuk disetujui" : "Catatan tersimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat catatan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (saving ? undefined : onOpenChange(v))}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Catat utang / piutang</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Jenis</Label>
            <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="receivable">Saya memberi piutang</SelectItem>
                <SelectItem value="payable">Saya berutang</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {preset ? (
            <p className="text-xs text-muted-foreground">Lawan transaksi: {preset.counterpartName}</p>
          ) : (
            <div className="space-y-1.5">
              <Label>Lawan transaksi</Label>
              <Select value={form.contact} onValueChange={(v) => setForm((p) => ({ ...p, contact: v }))}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Pilih kontak" />
                </SelectTrigger>
                <SelectContent>
                  {(contacts ?? []).map((c) => (
                    <SelectItem key={c.contact_id} value={c.contact_id}>
                      {c.profile.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(contacts ?? []).length === 0 && (
                <p className="text-[11px] text-muted-foreground">Belum ada kontak. Tambah kontak dulu lewat menu Chat.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ledger-amount">Nominal (Rp)</Label>
            <Input
              id="ledger-amount"
              inputMode="numeric"
              className="h-11"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value.replace(/\D/g, "") }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ledger-due">Jatuh tempo (opsional)</Label>
            <Input
              id="ledger-due"
              type="date"
              className="h-11"
              value={form.dueDate}
              onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ledger-note">Keterangan</Label>
            <Textarea id="ledger-note" maxLength={200} value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div>
              <p className="text-sm font-medium">Pengingat jatuh tempo</p>
              <p className="text-xs text-muted-foreground">Kirim notifikasi saat mendekati jatuh tempo</p>
            </div>
            <Switch checked={form.reminder} onCheckedChange={(v) => setForm((p) => ({ ...p, reminder: v }))} />
          </div>
        </div>
        <DialogFooter>
          <Button className="h-11 w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
            <Wallet className="size-4" /> {saving ? "Menyimpan…" : "Simpan catatan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
