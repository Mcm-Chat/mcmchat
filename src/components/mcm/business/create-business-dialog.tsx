import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { createBusiness } from "@/lib/api/business";

/**
 * Dialog "Buat Bisnis" dipakai bersama oleh empty-state hub dan menu header,
 * sehingga aksinya tidak lagi tersembunyi di dalam katalog.
 */
export function CreateBusinessDialog({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", category: "Umum" });
  const [saving, setSaving] = useState(false);
  const valid = form.name.trim().length >= 3;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createBusiness(userId, form.name.trim(), form.category.trim() || "Umum");
      void qc.invalidateQueries({ queryKey: ["business", userId] });
      void qc.invalidateQueries({ queryKey: ["my-business", userId] });
      onOpenChange(false);
      setForm({ name: "", category: "Umum" });
      toast.success("Bisnis dibuat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat bisnis");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (saving ? undefined : onOpenChange(v))}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Buat bisnis</DialogTitle>
          <DialogDescription>
            Bisnis menampung katalog produk, stok gudang, dan tugas penyiapan pegawai.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="biz-name">Nama bisnis</Label>
            <Input
              id="biz-name"
              value={form.name}
              maxLength={60}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Contoh: Toko Kopi Nusa"
            />
            {form.name.length > 0 && !valid && (
              <p className="text-xs text-destructive">Nama bisnis minimal 3 karakter.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="biz-cat">Kategori</Label>
            <Input
              id="biz-cat"
              value={form.category}
              maxLength={40}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Contoh: Kuliner"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            className="w-full rounded-xl"
            disabled={saving || !valid}
            onClick={() => void submit()}
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
