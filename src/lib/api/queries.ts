import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listContacts, listRequests } from "./contacts";
import { listConversations, listMessages } from "./chat";
import { listCalls } from "./calls";
import { listLedgers } from "./ledger";
import { listOrders, listSales } from "./sales";
import { listProducts, myBusiness } from "./business";
import { listReceipts, markDelivered } from "./receipts";

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
  useQuery({ queryKey: qk.conversations(uid ?? ""), queryFn: () => listConversations(uid!), enabled: !!uid });

export const useMessages = (cid: string, uid?: string) =>
  useQuery({ queryKey: qk.messages(cid), queryFn: () => listMessages(cid, uid!), enabled: !!uid && !!cid });

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
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`mcm-sync-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const row = (payload.new ?? payload.old) as { conversation_id?: string; sender_id?: string } | null;
        if (row?.conversation_id) void qc.invalidateQueries({ queryKey: qk.messages(row.conversation_id) });
        void qc.invalidateQueries({ queryKey: qk.conversations(uid) });
        // Penerima langsung mencatat delivery receipt untuk pesan masuk.
        if (payload.eventType === "INSERT" && row?.conversation_id && row.sender_id && row.sender_id !== uid) {
          void markDelivered(row.conversation_id).then(() =>
            qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" }),
          );
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_receipts" }, () => {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        void qc.invalidateQueries({ queryKey: qk.conversations(uid) });
      })
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
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [uid, qc]);
}
