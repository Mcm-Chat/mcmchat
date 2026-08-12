import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createDemoState } from "./demo";
import type {
  Chat,
  LedgerEntry,
  LedgerPayment,
  MCMState,
  Message,
  Order,
  Product,
} from "./types";

const KEY = "mcm-state-v1";

type Ctx = {
  state: MCMState;
  ready: boolean;
  update: (fn: (draft: MCMState) => MCMState) => void;
  resetDemo: () => void;
};

const MCMContext = createContext<Ctx | null>(null);

export function MCMProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MCMState>(() => createDemoState());
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MCMState;
        if (parsed && parsed.version === 1) setState(parsed);
      }
    } catch {
      /* abaikan penyimpanan rusak */
    }
    loaded.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* kuota penuh */
    }
  }, [state]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", state.settings.theme === "dark");
  }, [state.settings.theme]);

  const update = useCallback((fn: (draft: MCMState) => MCMState) => {
    setState((prev) => fn(structuredClone(prev)));
  }, []);

  const resetDemo = useCallback(() => {
    const fresh = createDemoState();
    fresh.authed = true;
    fresh.onboarded = true;
    setState(fresh);
  }, []);

  const value = useMemo(() => ({ state, ready, update, resetDemo }), [state, ready, update, resetDemo]);
  return <MCMContext.Provider value={value}>{children}</MCMContext.Provider>;
}

export function useMCM() {
  const ctx = useContext(MCMContext);
  if (!ctx) throw new Error("useMCM harus dipakai di dalam MCMProvider");
  return ctx;
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

/* ---------------- selectors & helpers ---------------- */

export const ME: string = "me";

/** Pesan yang benar-benar terlihat oleh pengguna saat ini (tanpa tombstone & tanpa yang dihapus lokal). */
export function visibleForMe(state: MCMState, m: Message): boolean {
  if ((state.deletedMessageIds ?? []).includes(m.id)) return false;
  return !(m.hiddenFor ?? []).includes(ME);
}

export function chatMessages(state: MCMState, chatId: string): Message[] {
  return state.messages
    .filter((m) => m.chatId === chatId && visibleForMe(state, m))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Sembunyikan pesan hanya untuk perangkat/akun ini. Sisi lawan tidak berubah. */
export function deleteForMe(draft: MCMState, ids: string[]): MCMState {
  for (const m of draft.messages) {
    if (!ids.includes(m.id)) continue;
    const hidden = new Set(m.hiddenFor ?? []);
    hidden.add(ME);
    m.hiddenFor = [...hidden];
  }
  return cleanupAfterDelete(draft);
}

/**
 * Hapus permanen dari shared conversation store (dua sisi) — tanpa placeholder.
 * Tombstone hanya dipakai untuk konsistensi sinkronisasi dan tidak pernah dirender.
 */
export function deleteForEveryone(draft: MCMState, ids: string[]): MCMState {
  const target = new Set(draft.messages.filter((m) => ids.includes(m.id) && m.senderId === ME).map((m) => m.id));
  if (target.size === 0) return draft;
  draft.messages = draft.messages.filter((m) => !target.has(m.id));
  const tomb = new Set(draft.deletedMessageIds ?? []);
  for (const t of target) tomb.add(t);
  draft.deletedMessageIds = [...tomb].slice(-500);
  return cleanupAfterDelete(draft);
}

/** Bersihkan referensi menggantung: reply, unread, dan tombstone yang sudah tidak dipakai. */
function cleanupAfterDelete(draft: MCMState): MCMState {
  const alive = new Set(draft.messages.filter((m) => visibleForMe(draft, m)).map((m) => m.id));
  for (const m of draft.messages) {
    if (m.replyToId && !alive.has(m.replyToId)) m.replyToId = undefined;
  }
  for (const c of draft.chats) {
    const remaining = draft.messages.filter((m) => m.chatId === c.id && visibleForMe(draft, m) && m.senderId !== ME).length;
    if (c.unread > remaining) c.unread = remaining;
  }
  const existing = new Set(draft.messages.map((m) => m.id));
  draft.deletedMessageIds = (draft.deletedMessageIds ?? []).filter((tid) => !existing.has(tid));
  return draft;
}

export function lastMessage(state: MCMState, chatId: string): Message | undefined {
  const list = chatMessages(state, chatId);
  return list[list.length - 1];
}

export function chatSortValue(state: MCMState, chat: Chat) {
  const last = lastMessage(state, chat.id);
  return last ? new Date(last.at).getTime() : 0;
}

export function ledgerRemaining(l: LedgerEntry) {
  return Math.max(0, l.amount - l.paid);
}

export function ledgerTotals(state: MCMState) {
  const active = state.ledgers.filter((l) => ["aktif", "sebagian", "menunggu", "disengketakan"].includes(l.status));
  const utang = active.filter((l) => l.type === "utang").reduce((s, l) => s + ledgerRemaining(l), 0);
  const piutang = active.filter((l) => l.type === "piutang").reduce((s, l) => s + ledgerRemaining(l), 0);
  const jatuhTempo = active.filter((l) => {
    const d = (new Date(l.dueDate).getTime() - Date.now()) / 86400000;
    return d <= 7;
  });
  const monthStart = new Date();
  monthStart.setDate(1);
  const lunasBulanIni = state.ledgers.filter(
    (l) => l.status === "lunas" && new Date(l.payments[l.payments.length - 1]?.at ?? l.date) >= monthStart,
  );
  return { utang, piutang, jatuhTempo, lunasBulanIni };
}

export function productPrice(p: Product) {
  return Math.round(p.price * (1 - p.discountPercent / 100));
}

export function orderTotal(o: Order) {
  return o.items.reduce((s, i) => s + i.price * i.qty, 0) + o.shipping;
}

export function applyPayment(l: LedgerEntry, payment: LedgerPayment): LedgerEntry {
  const paid = Math.min(l.amount, l.paid + payment.amount);
  const status: LedgerEntry["status"] = paid >= l.amount ? "lunas" : "sebagian";
  return {
    ...l,
    paid,
    status,
    payments: [...l.payments, payment],
    timeline: [
      ...l.timeline,
      {
        id: uid("ev"),
        at: new Date().toISOString(),
        actor: "Andi Pratama",
        label: paid >= l.amount ? "Pelunasan dicatat" : "Pembayaran dicatat",
        detail: `${payment.method}`,
      },
    ],
  };
}
