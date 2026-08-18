import type { QueryClient } from "@tanstack/react-query";

import { qk } from "@/lib/api/queries";
import type { LedgerPaymentRow, LedgerRow } from "@/lib/api/ledger";

type LedgerDetail = {
  ledger: LedgerRow;
  payments: LedgerPaymentRow[];
  events: unknown[];
};

/** Recompute status the same way the server RPC does. */
function nextStatus(ledger: LedgerRow, paid: number): LedgerRow["status"] {
  const settled = ledger.status === "active" || ledger.status === "partially_paid" || ledger.status === "paid";
  if (!settled) return ledger.status;
  if (paid >= Number(ledger.amount)) return "paid";
  if (paid > 0) return "partially_paid";
  return "active";
}

function patchLists(qc: QueryClient, ledgerId: string, patch: (l: LedgerRow) => LedgerRow) {
  qc.setQueriesData<LedgerRow[]>({ queryKey: ["ledgers"] }, (rows) =>
    rows ? rows.map((r) => (r.id === ledgerId ? patch(r) : r)) : rows,
  );
}

/** Snapshot detail + list caches; returned fn restores them on failure. */
function snapshot(qc: QueryClient, ledgerId: string) {
  const detail = qc.getQueryData<LedgerDetail>(qk.ledger(ledgerId));
  const lists = qc.getQueriesData<LedgerRow[]>({ queryKey: ["ledgers"] });
  return () => {
    qc.setQueryData(qk.ledger(ledgerId), detail);
    for (const [key, value] of lists) qc.setQueryData(key, value);
  };
}

export function optimisticRecordPayment(
  qc: QueryClient,
  ledgerId: string,
  input: { amount: number; method: string; note?: string | null; paidAt?: string | null },
) {
  const rollback = snapshot(qc, ledgerId);
  const tempId = `optimistic-${Date.now()}`;
  const paidAt = input.paidAt ?? new Date().toISOString();

  qc.setQueryData<LedgerDetail>(qk.ledger(ledgerId), (prev) => {
    if (!prev) return prev;
    const paid = Number(prev.ledger.paid_amount) + input.amount;
    const optimisticPayment = {
      id: tempId,
      ledger_id: ledgerId,
      amount: input.amount,
      method: input.method,
      note: input.note ?? null,
      paid_at: paidAt,
    } as unknown as LedgerPaymentRow;
    return {
      ...prev,
      ledger: { ...prev.ledger, paid_amount: paid, status: nextStatus(prev.ledger, paid) },
      payments: [optimisticPayment, ...prev.payments],
    };
  });

  patchLists(qc, ledgerId, (l) => {
    const paid = Number(l.paid_amount) + input.amount;
    return { ...l, paid_amount: paid, status: nextStatus(l, paid) };
  });

  return rollback;
}

export function optimisticDeletePayment(qc: QueryClient, ledgerId: string, paymentId: string) {
  const rollback = snapshot(qc, ledgerId);
  const detail = qc.getQueryData<LedgerDetail>(qk.ledger(ledgerId));
  const removed = detail?.payments.find((p) => p.id === paymentId);
  const amount = Number(removed?.amount ?? 0);

  qc.setQueryData<LedgerDetail>(qk.ledger(ledgerId), (prev) => {
    if (!prev) return prev;
    const paid = Math.max(0, Number(prev.ledger.paid_amount) - amount);
    return {
      ...prev,
      ledger: { ...prev.ledger, paid_amount: paid, status: nextStatus(prev.ledger, paid) },
      payments: prev.payments.filter((p) => p.id !== paymentId),
    };
  });

  patchLists(qc, ledgerId, (l) => {
    const paid = Math.max(0, Number(l.paid_amount) - amount);
    return { ...l, paid_amount: paid, status: nextStatus(l, paid) };
  });

  return rollback;
}
