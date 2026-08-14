import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { StatusBadge } from "@/components/mcm/primitives";
import { rupiah } from "@/lib/mcm/format";
import {
  ORDER_STATUS_LABEL,
  ORDER_STEPS,
  approveChatOrder,
  cancelChatOrder,
  confirmChatOrder,
  dispatchChatOrder,
  finalizeChatOrderDelivery,
  getChatOrder,
  orderTotals,
  requestChatOrderChanges,
  totalUnits,
  validatePayment,
  type ChatOrderFull,
  type ChatOrderItemRow,
  type PaymentInput,
  type SlotPlan,
} from "@/lib/api/chat-orders";
import { listAvailableUnits } from "@/lib/api/stock-units";

const orderKey = (id: string) => ["chat-order", id];

function statusTone(status: ChatOrderFull["status"]) {
  if (status === "cancelled") return "danger" as const;
  if (status === "delivered") return "success" as const;
  if (status === "ready_for_payment") return "primary" as const;
  return "warning" as const;
}

/**
 * Kartu pesanan hidup di dalam chat. Statusnya selalu dibaca dari server,
 * dan tombol yang muncul hanya yang benar-benar sah untuk peran + status saat ini.
 */
export function ChatOrderCard({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: orderKey(orderId),
    queryFn: () => getChatOrder(orderId),
    refetchInterval: 15000,
  });

  const { data: me } = useQuery({
    queryKey: ["me", "id"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 300000,
  });

  const { data: canSell = false } = useQuery({
    queryKey: ["chat-order", "can-sell", order?.business_id],
    queryFn: async () => {
      const { data } = await supabase.rpc("current_user_can_sell_business", {
        _business: order!.business_id,
      });
      return !!data;
    },
    enabled: !!order?.business_id,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: orderKey(orderId) });

  if (isLoading || !order) {
    return (
      <div className="w-60 rounded-xl border border-border bg-card/60 p-3 text-xs text-muted-foreground">
        Memuat pesanan…
      </div>
    );
  }

  const isBuyer = !!me && order.buyer_user_id === me;
  const { total } = orderTotals(order);
  const stepIndex = ORDER_STEPS.indexOf(order.status);
  const live = order.status !== "cancelled" && order.status !== "delivered";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      refresh();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memproses pesanan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-64 space-y-2 rounded-xl border border-border bg-card p-3 text-foreground">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <ClipboardList className="size-4 text-primary" /> Pesanan
        </div>
        <StatusBadge tone={statusTone(order.status)}>{ORDER_STATUS_LABEL[order.status]}</StatusBadge>
      </div>

      {live && stepIndex >= 0 && (
        <div className="flex gap-1" aria-label="Kemajuan pesanan">
          {ORDER_STEPS.map((s, i) => (
            <span
              key={s}
              className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      )}

      <ul className="space-y-1">
        {order.items.map((i) => (
          <li key={i.id} className="text-[11px] leading-tight">
            <span className="font-medium">{i.product_name}</span> · {i.variant_name}
            <br />
            {i.unit_count} unit × {Number(i.per_unit_qty)} {i.per_unit_unit} ·{" "}
            {rupiah(Math.max(0, Number(i.price) - Number(i.discount)) * i.unit_count)}
            {i.availability_note ? (
              <em className="block text-muted-foreground">{i.availability_note}</em>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-border pt-1.5 text-xs font-semibold">
        <span>{totalUnits(order.items)} unit</span>
        <span className="text-primary">{rupiah(total)}</span>
      </div>

      {order.seller_note ? (
        <p className="text-[11px] text-muted-foreground">Catatan toko: {order.seller_note}</p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {canSell && order.status === "buyer_requested" && (
          <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => setConfirmOpen(true)}>
            Konfirmasi & harga
          </Button>
        )}
        {canSell && order.status === "changes_requested" && (
          <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => setConfirmOpen(true)}>
            Kirim ulang penawaran
          </Button>
        )}
        {isBuyer && order.status === "seller_confirmed" && (
          <>
            <Button
              size="sm"
              className="h-8 rounded-lg text-[11px]"
              disabled={busy}
              onClick={() => void run(() => approveChatOrder(order.id), "Pesanan disetujui")}
            >
              Setujui
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-[11px]"
              onClick={() => setChangeOpen(true)}
            >
              Minta ubah
            </Button>
          </>
        )}
        {canSell && order.status === "buyer_approved" && (
          <Button
            size="sm"
            className="h-8 rounded-lg text-[11px]"
            onClick={() => setDispatchOpen(true)}
          >
            Lanjut ke pegawai
          </Button>
        )}
        {canSell && order.status === "ready_for_payment" && (
          <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => setPayOpen(true)}>
            Bayar & kirim
          </Button>
        )}
        {live && (canSell || isBuyer) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-lg text-[11px] text-destructive"
            disabled={busy}
            onClick={() => void run(() => cancelChatOrder(order.id, "Dibatalkan"), "Pesanan dibatalkan")}
          >
            Batalkan
          </Button>
        )}
      </div>

      {confirmOpen && (
        <ConfirmOrderDialog
          order={order}
          onClose={() => setConfirmOpen(false)}
          onDone={() => {
            setConfirmOpen(false);
            refresh();
          }}
        />
      )}
      {dispatchOpen && (
        <DispatchDialog
          order={order}
          onClose={() => setDispatchOpen(false)}
          onDone={() => {
            setDispatchOpen(false);
            refresh();
          }}
        />
      )}
      {payOpen && (
        <PaymentDialog
          order={order}
          total={total}
          onClose={() => setPayOpen(false)}
          onDone={() => {
            setPayOpen(false);
            refresh();
          }}
        />
      )}
      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Minta perubahan</DialogTitle>
          </DialogHeader>
          <ChangeRequestBody
            onSubmit={(note) =>
              void run(async () => {
                await requestChatOrderChanges(order.id, note);
                setChangeOpen(false);
              }, "Permintaan perubahan dikirim")
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChangeRequestBody({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <>
      <Textarea
        value={note}
        rows={3}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Tulis perubahan yang Anda inginkan…"
      />
      <DialogFooter>
        <Button
          className="w-full rounded-xl"
          disabled={note.trim().length < 3}
          onClick={() => onSubmit(note.trim())}
        >
          Kirim
        </Button>
      </DialogFooter>
    </>
  );
}

function ConfirmOrderDialog({
  order,
  onClose,
  onDone,
}: {
  order: ChatOrderFull;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState(() =>
    order.items.map((i) => ({
      id: i.id,
      unit_count: String(i.unit_count),
      price: String(Number(i.price)),
      discount: String(Number(i.discount)),
      availability_note: i.availability_note ?? "",
    })),
  );
  const [note, setNote] = useState(order.seller_note ?? "");
  const [extra, setExtra] = useState(String(Number(order.extra_fee)));
  const [discount, setDiscount] = useState(String(Number(order.discount)));
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    const sub = rows.reduce(
      (s, r) =>
        s + Math.max(0, Number(r.price || 0) - Number(r.discount || 0)) * Number(r.unit_count || 0),
      0,
    );
    return Math.max(0, sub - Number(discount || 0) + Number(extra || 0));
  }, [rows, discount, extra]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await confirmChatOrder({
        orderId: order.id,
        items: rows.map((r) => ({
          id: r.id,
          unit_count: Number(r.unit_count) || 0,
          price: Number(r.price) || 0,
          discount: Number(r.discount) || 0,
          availability_note: r.availability_note,
        })),
        note,
        discount: Number(discount) || 0,
        extraFee: Number(extra) || 0,
      });
      toast.success("Penawaran dikirim ke pembeli");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengonfirmasi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Konfirmasi pesanan</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {order.items.map((i, idx) => (
            <div key={i.id} className="space-y-2 rounded-xl border border-border p-2.5">
              <p className="text-xs font-semibold">
                {i.product_name} · {i.variant_name}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Unit</Label>
                  <Input
                    inputMode="numeric"
                    value={rows[idx]!.unit_count}
                    onChange={(e) =>
                      setRows((r) =>
                        r.map((x, j) => (j === idx ? { ...x, unit_count: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Harga</Label>
                  <Input
                    inputMode="numeric"
                    value={rows[idx]!.price}
                    onChange={(e) =>
                      setRows((r) => r.map((x, j) => (j === idx ? { ...x, price: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Diskon</Label>
                  <Input
                    inputMode="numeric"
                    value={rows[idx]!.discount}
                    onChange={(e) =>
                      setRows((r) =>
                        r.map((x, j) => (j === idx ? { ...x, discount: e.target.value } : x)),
                      )
                    }
                  />
                </div>
              </div>
              <Input
                placeholder="Catatan ketersediaan (opsional)"
                value={rows[idx]!.availability_note}
                onChange={(e) =>
                  setRows((r) =>
                    r.map((x, j) => (j === idx ? { ...x, availability_note: e.target.value } : x)),
                  )
                }
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Diskon pesanan</Label>
              <Input inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Ongkos / biaya</Label>
              <Input inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} />
            </div>
          </div>
          <Textarea
            rows={2}
            placeholder="Catatan untuk pembeli"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-sm font-semibold">Total: {rupiah(preview)}</p>
        </div>
        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? "Mengirim…" : "Kirim penawaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type StaffRow = { user_id: string; display_name: string; role: string };

function DispatchDialog({
  order,
  onClose,
  onDone,
}: {
  order: ChatOrderFull;
  onClose: () => void;
  onDone: () => void;
}) {
  const [assigned, setAssigned] = useState("");
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: staff = [] } = useQuery({
    queryKey: ["business", "staff", order.business_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("business_staff_directory", {
        _business: order.business_id,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as StaffRow[];
    },
  });

  const variantIds = useMemo(
    () => Array.from(new Set(order.items.map((i) => i.variant_id))),
    [order.items],
  );

  const { data: unitsByVariant = {} } = useQuery({
    queryKey: ["chat-order", "avail", order.id, variantIds],
    queryFn: async () => {
      const out: Record<string, { id: string; unit_label: string; unit_seq: number }[]> = {};
      for (const vid of variantIds) {
        out[vid] = (await listAvailableUnits(vid)).map((u) => ({
          id: u.id,
          unit_label: u.unit_label,
          unit_seq: u.unit_seq,
        }));
      }
      return out;
    },
  });

  const slots = useMemo(() => {
    const list: { item: ChatOrderItemRow; slotNo: number; key: string }[] = [];
    for (const item of order.items) {
      for (let n = 1; n <= item.unit_count; n++) {
        list.push({ item, slotNo: n, key: `${item.id}:${n}` });
      }
    }
    return list;
  }, [order.items]);

  const submit = async () => {
    if (saving) return;
    if (!assigned) {
      toast.error("Pilih pegawai yang menyiapkan");
      return;
    }
    const used = new Set<string>();
    const payload: SlotPlan[] = [];
    for (const s of slots) {
      const choice = plan[s.key] ?? "new";
      if (choice !== "new") {
        if (used.has(choice)) {
          toast.error("Satu unit siap tidak bisa dipakai untuk dua slot");
          return;
        }
        used.add(choice);
      }
      payload.push({
        itemId: s.item.id,
        slotNo: s.slotNo,
        mode: choice === "new" ? "new_unit" : "existing_unit",
        stockUnitId: choice === "new" ? null : choice,
      });
    }
    setSaving(true);
    try {
      const res = await dispatchChatOrder({
        orderId: order.id,
        assignedUserId: assigned,
        slots: payload,
      });
      toast.success(`Perintah penyiapan ${res.code} dikirim`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal melanjutkan ke pegawai");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Lanjut ke pegawai</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Pegawai penyiap</Label>
            <Select value={assigned} onValueChange={setAssigned}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih pegawai" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.user_id} value={s.user_id}>
                    {s.display_name} · {s.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tiap unit disiapkan terpisah. Pilih barang siap yang sudah ada, atau minta pegawai
            menyiapkan unit baru lengkap dengan foto dan lokasi.
          </p>
          {slots.map((s) => {
            const avail = unitsByVariant[s.item.variant_id] ?? [];
            return (
              <div key={s.key} className="space-y-1.5 rounded-xl border border-border p-2.5">
                <p className="text-xs font-semibold">
                  {s.item.product_name} · {s.item.variant_name} — unit {s.slotNo}/{s.item.unit_count}
                </p>
                <Select
                  value={plan[s.key] ?? "new"}
                  onValueChange={(v) => setPlan((p) => ({ ...p, [s.key]: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Siapkan unit baru</SelectItem>
                    {avail.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.unit_label || `Unit #${u.unit_seq}`} (siap)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button className="w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
            {saving ? "Mengirim…" : "Kirim perintah penyiapan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({
  order,
  total,
  onClose,
  onDone,
}: {
  order: ChatOrderFull;
  total: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PaymentInput["paymentMethod"]>("cash");
  const [paid, setPaid] = useState(String(total));
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);

  const payment: PaymentInput = {
    paymentMethod: method,
    paidAmount: method === "credit" ? 0 : Number(paid) || 0,
    dueDate: due || null,
  };
  const errors = validatePayment(payment, total);

  const submit = async () => {
    if (saving) return;
    if (errors.length > 0) {
      toast.error(errors[0]!);
      return;
    }
    setSaving(true);
    try {
      const res = await finalizeChatOrderDelivery({ orderId: order.id, payment });
      toast.success(res.already ? "Pesanan sudah terkirim" : `Terkirim · ${res.number}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mencatat pembayaran");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Pembayaran & pengiriman</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm font-semibold">Total: {rupiah(total)}</p>
          <div className="space-y-1.5">
            <Label>Metode pembayaran</Label>
            <Select
              value={method}
              onValueChange={(v) => {
                const m = v as PaymentInput["paymentMethod"];
                setMethod(m);
                if (m === "cash" || m === "transfer") setPaid(String(total));
                if (m === "credit") setPaid("0");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tunai</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="dp">DP / uang muka</SelectItem>
                <SelectItem value="credit">Kredit / tempo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {method !== "credit" && (
            <div className="space-y-1.5">
              <Label>Jumlah dibayar</Label>
              <Input inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value)} />
            </div>
          )}
          {(method === "dp" || method === "credit") && (
            <div className="space-y-1.5">
              <Label>Jatuh tempo</Label>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          )}
          {errors.length > 0 && <p className="text-[11px] text-destructive">{errors[0]}</p>}
          <p className="text-[11px] text-muted-foreground">
            Sisa pembayaran otomatis tercatat sebagai piutang di modul Keuangan, dan unit yang
            dikirim berpindah kepemilikan ke pembeli.
          </p>
        </div>
        <DialogFooter>
          <Button
            className="w-full rounded-xl"
            disabled={saving || errors.length > 0}
            onClick={() => void submit()}
          >
            {saving ? "Memproses…" : "Catat & kirim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
