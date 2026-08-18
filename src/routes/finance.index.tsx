import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Plus, Receipt, ShoppingBag, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { EmptyState, ListErrorState, LoadingSkeleton } from "@/components/mcm/primitives";
import {
  ContactSummaryRow,
  DailySummaryRow,
  FinanceSummaryCard,
  LedgerListItem,
  OrderListItem,
  SalesListItem,
} from "@/components/mcm/finance-parts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LedgerFormDialog } from "@/components/mcm/lazy-heavy";
import { useRequireAuth } from "@/lib/api/guard";
import { useLedgers, useMyBusiness, useOrders, useSales, qk } from "@/lib/api/queries";
import { useQueryClient } from "@tanstack/react-query";
import { OPEN_STATUSES, type LedgerRow } from "@/lib/api/ledger";
import { financeSummary, salesPayload } from "@/lib/api/finance";
import { contactSummary, dailySummary } from "@/lib/api/ledger-summary";
import { updateOrderStatus, type OrderRow, type SalesRecordRow } from "@/lib/api/sales";
import { rupiah, tanggal } from "@/lib/mcm/format";
import { supabase } from "@/integrations/supabase/client";
import { LedgerSkeleton } from "@/components/mcm/route-skeletons";

export const Route = createFileRoute("/finance/")({
  head: () => ({
    meta: [
      { title: "Keuangan — MCM" },
      {
        name: "description",
        content:
          "Ringkasan piutang, utang, penjualan, dan pesanan bisnis Anda dalam satu tampilan.",
      },
      { property: "og:title", content: "Keuangan — MCM" },
      {
        property: "og:description",
        content: "Pantau piutang, utang, penjualan, dan pesanan bisnis.",
      },
    ],
  }),
  component: FinancePage,
  pendingComponent: () => <LedgerSkeleton />,
});

function FinancePage() {
  const { userId, loading } = useRequireAuth();
  const qc = useQueryClient();
  const {
    data: ledgers,
    isLoading: ledgersLoading,
    isError: ledgersError,
    refetch: refetchLedgers,
  } = useLedgers(userId);
  const { data: biz, isLoading: bizLoading } = useMyBusiness(userId);
  const businessId = biz?.business.id;
  const {
    data: sales,
    isLoading: salesLoading,
    isError: salesError,
    refetch: refetchSales,
  } = useSales(businessId);
  const {
    data: orders,
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
  } = useOrders(businessId);

  // Catatan utang/piutang milik saya maupun yang dikirim pihak lain harus
  // memperbarui daftar dan kartu ringkasan tanpa refresh manual.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`finance-rt-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ledgers" }, () => {
        void qc.invalidateQueries({ queryKey: qk.ledgers(userId) });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const [mainTab, setMainTab] = useState("catatan");
  const [ledgerFilter, setLedgerFilter] = useState("semua");
  const [selectedSale, setSelectedSale] = useState<SalesRecordRow | null>(null);
  const [ledgerFormOpen, setLedgerFormOpen] = useState(false);

  const summary = useMemo(() => financeSummary(ledgers ?? [], sales ?? []), [ledgers, sales]);
  const daily = useMemo(
    () => (userId ? dailySummary(ledgers ?? [], userId) : []),
    [ledgers, userId],
  );
  const byContact = useMemo(
    () => (userId ? contactSummary(ledgers ?? [], userId) : []),
    [ledgers, userId],
  );

  const filteredLedgers = useMemo(() => {
    const all = ledgers ?? [];
    const today = Date.now();
    switch (ledgerFilter) {
      case "piutang":
        return all.filter((l) => l.type === "receivable" && OPEN_STATUSES.includes(l.status));
      case "utang":
        return all.filter((l) => l.type === "payable" && OPEN_STATUSES.includes(l.status));
      case "jatuh_tempo":
        return all.filter(
          (l) =>
            OPEN_STATUSES.includes(l.status) &&
            l.due_date &&
            new Date(l.due_date).getTime() <= today,
        );
      case "lunas":
        return all.filter((l) => l.status === "paid");
      default:
        return all;
    }
  }, [ledgers, ledgerFilter]);

  const changeOrderStatus = async (order: OrderRow, status: OrderRow["status"]) => {
    try {
      await updateOrderStatus(order.id, status);
      toast.success("Status pesanan diperbarui");
      void qc.invalidateQueries({ queryKey: qk.orders(businessId ?? "") });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui pesanan");
    }
  };

  const hasBusiness = !!businessId;

  return (
    <AppShell
      header={
        <MobileHeader
          title="Keuangan"
          subtitle="Piutang, utang, dan penjualan bisnis"
          actions={
            <Button
              size="icon"
              variant="secondary"
              aria-label="Catat utang atau piutang"
              className="size-11 shrink-0 rounded-xl"
              onClick={() => setLedgerFormOpen(true)}
            >
              <Plus className="size-5" />
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-2 px-3 pb-3">
            <FinanceSummaryCard
              label="Piutang"
              value={rupiah(summary.receivable)}
              hint="Belum dibayar ke Anda"
              tone="success"
            />
            <FinanceSummaryCard
              label="Utang"
              value={rupiah(summary.payable)}
              hint="Belum Anda bayar"
              tone="danger"
            />
            <FinanceSummaryCard
              label="Jatuh tempo"
              value={`${summary.dueCount} catatan`}
              hint={
                summary.overdueCount > 0
                  ? `${summary.overdueCount} sudah lewat`
                  : "Belum ada yang lewat"
              }
              tone="warning"
            />
            <FinanceSummaryCard
              label="Penjualan"
              value={rupiah(summary.salesToday)}
              hint={`Bulan ini ${rupiah(summary.salesMonth)}`}
              tone="primary"
            />
          </div>
        </MobileHeader>
      }
    >
      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
          <TabsTrigger value="catatan">Catatan</TabsTrigger>
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="penjualan">Penjualan</TabsTrigger>
          <TabsTrigger value="pesanan">Pesanan</TabsTrigger>
        </TabsList>
      </Tabs>

      {mainTab === "ringkasan" && (
        <div className="space-y-5 px-4 py-4 pb-24">
          {loading || ledgersLoading ? (
            <LoadingSkeleton rows={4} avatar={false} />
          ) : byContact.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Belum ada ringkasan"
              description="Ringkasan harian dan saldo per kontak muncul setelah ada catatan utang piutang."
            />
          ) : (
            <>
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Saldo per kontak</h2>
                <ul className="space-y-3">
                  {byContact.map((row) => (
                    <li key={row.key}>
                      <ContactSummaryRow row={row} />
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Ringkasan harian</h2>
                <ul className="space-y-2">
                  {daily.map((row) => (
                    <li key={row.day}>
                      <DailySummaryRow row={row} />
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      )}

      {mainTab === "catatan" && (
        <div className="space-y-3 px-4 py-4 pb-24">
          <Tabs value={ledgerFilter} onValueChange={setLedgerFilter}>
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
              <TabsTrigger value="jatuh_tempo" className="flex-1 rounded-lg text-xs">
                Jatuh tempo
              </TabsTrigger>
              <TabsTrigger value="lunas" className="flex-1 rounded-lg text-xs">
                Lunas
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {loading || ledgersLoading ? (
            <LoadingSkeleton rows={4} avatar={false} />
          ) : ledgersError ? (
            <ListErrorState
              title="Gagal memuat catatan"
              description="Catatan utang piutang tidak dapat diambil. Periksa koneksi Anda lalu coba lagi."
              onRetry={() => void refetchLedgers()}
              action={
                <Button className="rounded-xl" onClick={() => setLedgerFormOpen(true)}>
                  <Plus className="size-4" /> Tambah Catatan
                </Button>
              }
            />
          ) : filteredLedgers.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Belum ada catatan"
              description="Catatan utang piutang akan muncul di sini setelah transaksi dibuat."
              action={
                <Button className="h-11 rounded-xl" onClick={() => setLedgerFormOpen(true)}>
                  <Plus className="size-4" /> Tambah Catatan
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {filteredLedgers.map((l: LedgerRow) => (
                <li key={l.id}>
                  <LedgerListItem ledger={l} {...(userId ? { actorId: userId } : {})} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mainTab === "penjualan" && (
        <div className="space-y-3 px-4 py-4 pb-24">
          {loading || bizLoading ? (
            <LoadingSkeleton rows={4} avatar={false} />
          ) : !hasBusiness ? (
            <EmptyState
              icon={Briefcase}
              title="Belum ada bisnis"
              description="Buat bisnis terlebih dahulu di menu Bisnis untuk mulai mencatat penjualan."
            />
          ) : salesLoading ? (
            <LoadingSkeleton rows={4} avatar={false} />
          ) : salesError ? (
            <ListErrorState
              title="Gagal memuat penjualan"
              description="Data penjualan tidak dapat diambil. Periksa koneksi Anda lalu coba lagi."
              onRetry={() => void refetchSales()}
            />
          ) : (sales ?? []).length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Belum ada penjualan"
              description="Penjualan yang Anda catat akan muncul di sini."
            />
          ) : (
            <ul className="space-y-3">
              {(sales ?? []).map((s) => (
                <li key={s.id}>
                  <SalesListItem sale={s} onOpen={() => setSelectedSale(s)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mainTab === "pesanan" && (
        <div className="space-y-3 px-4 py-4 pb-24">
          {loading || bizLoading ? (
            <LoadingSkeleton rows={4} avatar={false} />
          ) : !hasBusiness ? (
            <EmptyState
              icon={Briefcase}
              title="Belum ada bisnis"
              description="Buat bisnis terlebih dahulu di menu Bisnis untuk mulai menerima pesanan."
            />
          ) : ordersLoading ? (
            <LoadingSkeleton rows={4} avatar={false} />
          ) : ordersError ? (
            <ListErrorState
              title="Gagal memuat pesanan"
              description="Data pesanan tidak dapat diambil. Periksa koneksi Anda lalu coba lagi."
              onRetry={() => void refetchOrders()}
            />
          ) : (orders ?? []).length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="Belum ada pesanan"
              description="Pesanan pelanggan akan muncul di sini."
            />
          ) : (
            <ul className="space-y-3">
              {(orders ?? []).map((o) => (
                <li key={o.id}>
                  <OrderListItem
                    order={o}
                    onChangeStatus={(status) => void changeOrderStatus(o, status)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mainTab === "catatan" && filteredLedgers.length > 0 && (
        <Button
          size="icon"
          aria-label="Catat utang atau piutang"
          className="fixed right-4 bottom-[calc(max(env(safe-area-inset-bottom),var(--mcm-kb,0px))+4.75rem)] z-40 size-14 rounded-full shadow-lg"
          onClick={() => setLedgerFormOpen(true)}
        >
          <Plus className="size-6" />
        </Button>
      )}

      {userId && (
        <LedgerFormDialog
          open={ledgerFormOpen}
          onOpenChange={setLedgerFormOpen}
          ownerId={userId}
          onCreated={() => {
            void refetchLedgers();
            setMainTab("catatan");
          }}
        />
      )}

      <Sheet open={!!selectedSale} onOpenChange={(v) => !v && setSelectedSale(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          {selectedSale && (
            <>
              <SheetHeader>
                <SheetTitle>{salesPayload(selectedSale).number}</SheetTitle>
              </SheetHeader>
              <div className="space-y-3 px-1 pb-4">
                <p className="text-sm text-muted-foreground">
                  {salesPayload(selectedSale).customerName} • {tanggal(selectedSale.created_at)}
                </p>
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {salesPayload(selectedSale).items.map((it, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-2 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{it.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {it.qty} x {rupiah(it.price)}
                        </p>
                      </div>
                      <p className="shrink-0 font-semibold">
                        {rupiah(it.qty * (it.price - it.discount))}
                      </p>
                    </li>
                  ))}
                  {salesPayload(selectedSale).items.length === 0 && (
                    <li className="p-3 text-center text-xs text-muted-foreground">
                      Tidak ada rincian item.
                    </li>
                  )}
                </ul>
                <div className="card-soft space-y-1 p-3 text-sm">
                  <div className="flex justify-between">
                    <span>Total</span>
                    <span className="font-semibold">{rupiah(Number(selectedSale.total))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dibayar</span>
                    <span>{rupiah(Number(selectedSale.paid_amount))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sisa</span>
                    <span>
                      {rupiah(Number(selectedSale.total) - Number(selectedSale.paid_amount))}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
