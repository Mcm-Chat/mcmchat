import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { BadgeCheck, ClipboardList, Copy, Link2, Plus, QrCode, RefreshCw, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmStaffPin,
  createPreparationJob,
  deliverPreparationJob,
  formatBase,
  listAgents,
  listVariants,
  prepareUrl,
  previewBase,
  revokeJob,
  rememberToken,
  recallToken,
  rotateToken,
  WEIGHT_UNITS,
  type JobWithItems,
  type NewJobItem,
  type ProductVariant,
} from "@/lib/api/prepare";
import { useProducts } from "@/lib/api/queries";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draf",
  sent: "Dikirim",
  opened: "Dibuka pegawai",
  in_progress: "Diproses",
  ready: "Siap",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

type DraftItem = NewJobItem & { key: string };

export function CreatePreparationDialog({
  open,
  onOpenChange,
  businessId,
  conversationId,
  customerName,
  customerUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: string;
  conversationId: string;
  customerName: string;
  customerUserId?: string | null;
  onCreated: (job: { id: string; code: string; token: string }) => void;
}) {
  const { data: products } = useProducts(businessId);
  const { data: variants } = useQuery({
    queryKey: ["variants", businessId],
    queryFn: () => listVariants(businessId),
    enabled: !!businessId && open,
  });
  const { data: agents } = useQuery({
    queryKey: ["agents", businessId],
    queryFn: () => listAgents(businessId),
    enabled: !!businessId && open,
  });
  const qc = useQueryClient();

  const [items, setItems] = useState<DraftItem[]>([]);
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [staffPin, setStaffPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);

  const selectedStaff = (agents ?? []).find((a) => a.id === assignee);

  const savePin = async () => {
    setSavingPin(true);
    try {
      const staff = await confirmStaffPin({ businessId, pin: staffPin });
      await qc.invalidateQueries({ queryKey: ["agents", businessId] });
      setAssignee(staff.id);
      setStaffPin("");
      toast.success(`Nomor MCM ${staff.pin} tersimpan untuk ${staff.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan nomor MCM pegawai");
    } finally {
      setSavingPin(false);
    }
  };

  const variantById = useMemo(() => new Map((variants ?? []).map((v) => [v.id, v])), [variants]);
  const productName = (v: ProductVariant) => (products ?? []).find((p) => p.id === v.product_id)?.name ?? "Produk";
  const current = variantId ? variantById.get(variantId) : undefined;
  const unitOptions = current?.stock_type === "weight" ? WEIGHT_UNITS.map((u) => u.unit) : [current?.display_unit ?? "pcs"];
  const activeUnit = unit || unitOptions[0] || "pcs";

  const addItem = () => {
    const v = current;
    const n = Number(qty.replace(",", "."));
    if (!v) { toast.error("Pilih varian produk dulu"); return; }
    if (!Number.isFinite(n) || n <= 0) { toast.error("Jumlah harus lebih dari nol"); return; }
    if (v.stock_type === "count" && !v.allow_decimal && !Number.isInteger(n)) {
      toast.error(`${v.name} hanya menerima jumlah bulat`);
      return;
    }
    setItems((p) => [...p, { key: crypto.randomUUID(), variant_id: v.id, qty: n, unit: activeUnit }]);
    setQty("1");
  };

  const submit = async () => {
    if (items.length === 0) { toast.error("Tambahkan minimal satu item"); return; }
    if (!assignee) { toast.error("Pilih pegawai penerima tugas"); return; }
    if (!selectedStaff?.pin) {
      toast.error("Konfirmasi dulu nomor MCM pegawai ini");
      return;
    }
    setSending(true);
    try {
      const job = await createPreparationJob({
        businessId,
        assignedUserId: assignee,
        conversationId,
        customerName,
        customerUserId: customerUserId ?? null,
        notes,
        items: items.map(({ key: _key, ...rest }) => rest),
      });
      rememberToken(job.id, job.token);
      const { pin } = await deliverPreparationJob(job.id, prepareUrl(job.token));
      toast.success(`Tautan perintah terkirim ke PIN MCM ${pin}`);
      onCreated(job);
      setItems([]);
      setNotes("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat perintah penyiapan");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[420px] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Perintah penyiapan</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Tugas ini khusus untuk <strong>{customerName}</strong>. Setiap permintaan pelanggan selalu menjadi tugas, tautan, dan barcode terpisah.
        </p>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="space-y-1.5">
            <Label>Produk & varian</Label>
            <Select
              value={variantId}
              onValueChange={(v) => {
                setVariantId(v);
                setUnit("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih varian" />
              </SelectTrigger>
              <SelectContent>
                {(variants ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {productName(v)} — {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="qty">Jumlah</Label>
              <Input id="qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Satuan</Label>
              <Select value={activeUnit} onValueChange={setUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {current && (
            <p className="text-[11px] text-muted-foreground">
              Setara {formatBase(current, previewBase(current, Number(qty.replace(",", ".")) || 0, activeUnit))} pada satuan dasar.
            </p>
          )}
          <Button type="button" variant="secondary" className="w-full rounded-xl" onClick={addItem}>
            <Plus className="size-4" /> Tambah item
          </Button>
        </div>

        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((it) => {
              const v = variantById.get(it.variant_id);
              return (
                <li key={it.key} className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {v ? `${productName(v)} — ${v.name}` : "Item"} · {it.qty} {it.unit}
                  </span>
                  <Button variant="ghost" size="icon" aria-label="Hapus item" onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1.5">
          <Label>Pegawai penerima</Label>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih pegawai" />
            </SelectTrigger>
            <SelectContent>
              {(agents ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prep-notes">Catatan untuk pegawai</Label>
          <Textarea id="prep-notes" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={sending} onClick={() => void submit()}>
            <ClipboardList className="size-4" /> Kirim tugas & buat barcode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PreparationJobCard({ job, onChanged }: { job: JobWithItems; onChanged: () => void }) {
  const [qrOpen, setQrOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => recallToken(job.id));
  const url = token ? prepareUrl(token) : "";
  const expired = new Date(job.expires_at).getTime() < Date.now() || !!job.revoked_at;

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Tautan tugas disalin");
  };

  const rotate = async () => {
    try {
      const fresh = await rotateToken(job.id);
      setToken(fresh);
      toast.success("Tautan baru diterbitkan; tautan lama tidak berlaku");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menerbitkan tautan");
    }
  };

  return (
    <div className="card-soft space-y-2 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{job.code}</span>
        <Badge variant={job.status === "completed" ? "default" : "secondary"}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
        {expired && <Badge variant="destructive">Tautan nonaktif</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">Pelanggan: {job.customer_name || "—"}</p>
      <ul className="space-y-0.5 text-xs">
        {job.items.map((i) => (
          <li key={i.id} className="truncate">
            • {i.product_name} — {i.variant_name}: {Number(i.requested_qty)} {i.requested_unit}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="rounded-lg" disabled={!token} onClick={() => setQrOpen(true)}>
          <QrCode className="size-4" /> Barcode
        </Button>
        <Button size="sm" variant="secondary" className="rounded-lg" disabled={!token} onClick={() => void copy()}>
          <Copy className="size-4" /> Salin link
        </Button>
        {token && (
          <Button size="sm" variant="ghost" className="rounded-lg" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <Link2 className="size-4" /> Buka tugas
            </a>
          </Button>
        )}
        <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => void rotate()}>
          <RefreshCw className="size-4" /> {token ? "Terbitkan ulang" : "Tampilkan tautan"}
        </Button>
        {!job.revoked_at && (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg text-destructive"
            onClick={() => void revokeJob(job.id).then(onChanged)}
          >
            <X className="size-4" /> Cabut
          </Button>
        )}
      </div>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-[340px] rounded-2xl text-center">
          <DialogHeader>
            <DialogTitle>{job.code}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {url && <QRCodeSVG value={url} size={240} includeMargin />}
            <p className="break-all text-[11px] text-muted-foreground">{url}</p>
            <Button variant="secondary" className="w-full rounded-xl" onClick={() => void copy()}>
              <Copy className="size-4" /> Salin tautan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
