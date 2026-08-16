import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listContacts, listRequests } from "./contacts";
import {
  compareMessages,
  cursorOf,
  listConversations,
  listMessages,
  MESSAGE_PAGE_SIZE,
  type MessageCursor,
  type MessageRow,
} from "./chat";
import { listCalls } from "./calls";
import { listLedgers } from "./ledger";
import { listOrders, listSales } from "./sales";
import { listProducts, myBusiness } from "./business";
import { listReceipts, markDelivered } from "./receipts";
import { registerSubscription } from "@/lib/realtime/connection";

export const qk = {
  conversations: (uid: string) => ["conversations", uid] as const,
  messages: (cid: string) => ["messages", cid] as const,
  receipts: (cid: string) => ["receipts", cid] as const,
  contacts: (uid: string) => ["contacts", uid] as const,
  requests: (uid: string) => ["requests", uid] as const,
  calls: (uid: string) => ["calls", uid] as const,
  ledgers: (uid: string) => ["ledgers", uid] as const,
  ledger: (id: string) => ["ledger", id] as const,
  business: (uid: string) => ["business", uid] as const,
  products: (bid: string) => ["products", bid] as const,
  orders: (bid: string) => ["orders", bid] as const,
  sales: (bid: string) => ["sales", bid] as const,
};

export const useConversations = (uid?: string) =>
  useQuery({
    queryKey: qk.conversations(uid ?? ""),
    queryFn: () => listConversations(uid!),
    enabled: !!uid,
  });

/**
 * Pesan dimuat per halaman (terbaru dulu) dan digabung menaik dengan urutan
 * stabil. Halaman lama diambil hanya saat pengguna menggulir ke atas.
 */
export function useMessages(cid: string, uid?: string) {
  const query = useInfiniteQuery({
    queryKey: qk.messages(cid),
    enabled: !!uid && !!cid,
    initialPageParam: null as MessageCursor | null,
    queryFn: ({ pageParam }) => listMessages(cid, uid!, { before: pageParam }),
    // Halaman dikembalikan menaik, jadi elemen pertama adalah pesan tertua —
    // kursor berikutnya memakai pasangan (created_at, id) miliknya.
    getNextPageParam: (last: MessageRow[]) =>
      last.length < MESSAGE_PAGE_SIZE || !last[0] ? undefined : cursorOf(last[0]),
  });
  const messages = useMemo(() => {
    const pages = (query.data as InfiniteData<MessageRow[]> | undefined)?.pages ?? [];
    const seen = new Set<string>();
    const flat: MessageRow[] = [];
    for (const page of pages)
      for (const m of page)
        if (!seen.has(m.id)) {
          seen.add(m.id);
          flat.push(m);
        }
    return flat.sort(compareMessages);
  }, [query.data]);
  return {
    messages,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    hasOlder: query.hasNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    fetchOlder: query.fetchNextPage,
  };
}

/** Tanda terima untuk pesan yang saya kirim di percakapan ini. */
export const useReceipts = (cid: string, myMessageIds: string[], uid?: string) =>
  useQuery({
    queryKey: [...qk.receipts(cid), myMessageIds.length],
    queryFn: () => listReceipts(myMessageIds, uid),
    enabled: !!uid && myMessageIds.length > 0,
  });

export const useContacts = (uid?: string) =>
  useQuery({ queryKey: qk.contacts(uid ?? ""), queryFn: () => listContacts(uid!), enabled: !!uid });

export const useRequests = (uid?: string) =>
  useQuery({ queryKey: qk.requests(uid ?? ""), queryFn: () => listRequests(uid!), enabled: !!uid });

export const useCalls = (uid?: string) =>
  useQuery({ queryKey: qk.calls(uid ?? ""), queryFn: () => listCalls(uid!), enabled: !!uid });

export const useLedgers = (uid?: string) =>
  useQuery({ queryKey: qk.ledgers(uid ?? ""), queryFn: () => listLedgers(uid!), enabled: !!uid });

export const useMyBusiness = (uid?: string) =>
  useQuery({ queryKey: qk.business(uid ?? ""), queryFn: () => myBusiness(uid!), enabled: !!uid });

export const useProducts = (bid?: string) =>
  useQuery({ queryKey: qk.products(bid ?? ""), queryFn: () => listProducts(bid!), enabled: !!bid });

export const useOrders = (bid?: string) =>
  useQuery({ queryKey: qk.orders(bid ?? ""), queryFn: () => listOrders(bid!), enabled: !!bid });

export const useSales = (bid?: string) =>
  useQuery({ queryKey: qk.sales(bid ?? ""), queryFn: () => listSales(bid!), enabled: !!bid });

/**
 * Satu langganan realtime untuk seluruh aplikasi: pesan baru/terhapus, catatan,
 * pesanan, dan panggilan langsung menyegarkan cache yang relevan.
 */
export function useRealtimeSync(uid?: string) {
  const qc = useQueryClient();
  const convTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!uid) return;
    // Daftar percakapan disegarkan dengan debounce agar burst pesan tidak
    // memicu pemuatan ulang berulang-ulang.
    const refreshConversations = () => {
      if (convTimer.current) clearTimeout(convTimer.current);
      convTimer.current = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: qk.conversations(uid) });
      }, 400);
    };

    const applyInsert = (row: MessageRow) => {
      qc.setQueryData<InfiniteData<MessageRow[]>>(qk.messages(row.conversation_id), (prev) => {
        if (!prev || prev.pages.length === 0) return prev;
        const exists = prev.pages.some((p) => p.some((m) => m.id === row.id));
        if (exists) return prev;
        const pages = prev.pages.map((p, i) => (i === 0 ? [...p, row].sort(compareMessages) : p));
        return { ...prev, pages };
      });
    };

    const applyDelete = (row: { id?: string; conversation_id?: string }) => {
      if (!row.conversation_id || !row.id) return;
      qc.setQueryData<InfiniteData<MessageRow[]>>(qk.messages(row.conversation_id), (prev) =>
        prev ? { ...prev, pages: prev.pages.map((p) => p.filter((m) => m.id !== row.id)) } : prev,
      );
    };

    /**
     * Perbarui badge unread di ChatList secara instan saat pesan masuk,
     * tanpa menunggu refetch daftar percakapan (yang di-debounce 400ms).
     * Percakapan yang sedang dibuka tidak dihitung sebagai unread.
     */
    const bumpUnread = (row: MessageRow) => {
      const openHere =
        typeof window !== "undefined" &&
        window.location.pathname.startsWith(`/chat/${row.conversation_id}`);
      qc.setQueryData<ConversationView[]>(qk.conversations(uid), (prev) =>
        prev
          ? prev.map((c) =>
              c.id === row.conversation_id
                ? {
                    ...c,
                    unread: openHere ? c.unread : c.unread + 1,
                    last_message_at: row.created_at ?? c.last_message_at,
                    lastMessage: {
                      id: row.id,
                      kind: row.kind,
                      body: row.body,
                      sender_id: row.sender_id,
                      created_at: row.created_at,
                      attachment_name: row.attachment_name,
                      location_lat: row.location_lat,
                    },
                  }
                : c,
            )
          : prev,
      );
    };

    const unsubscribe = registerSubscription(`mcm-sync-${uid}`, (name) =>
      supabase
        .channel(name)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
          const row = (payload.new ?? payload.old) as MessageRow | null;
          if (!row?.conversation_id) return;
          if (payload.eventType === "INSERT") applyInsert(row);
          else if (payload.eventType === "DELETE") applyDelete(row);
          else void qc.invalidateQueries({ queryKey: qk.messages(row.conversation_id) });
          refreshConversations();
          // Penerima mencatat delivery receipt untuk pesan masuk.
          if (payload.eventType === "INSERT" && row.sender_id && row.sender_id !== uid) {
            bumpUnread(row);
            void markDelivered(row.conversation_id).then(() =>
              qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" }),
            );
          }
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "message_receipts" }, () => {
          void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" });
          refreshConversations();
        })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversation_members" },
          () => {
            refreshConversations();
          },
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "ledgers" }, () => {
          void qc.invalidateQueries({ queryKey: qk.ledgers(uid) });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "contact_requests" }, () => {
          void qc.invalidateQueries({ queryKey: qk.requests(uid) });
          void qc.invalidateQueries({ queryKey: qk.contacts(uid) });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => {
          void qc.invalidateQueries({ queryKey: qk.calls(uid) });
        })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "call_participants" },
          () => {
            void qc.invalidateQueries({ queryKey: qk.calls(uid) });
          },
        ),
    );
    return () => {
      if (convTimer.current) clearTimeout(convTimer.current);
      unsubscribe();
    };
  }, [uid, qc]);
}
