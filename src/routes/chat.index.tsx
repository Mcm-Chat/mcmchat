import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MessageCirclePlus, MessagesSquare, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ChatListItem } from "@/components/mcm/chat-parts";
import { AccessFallback } from "@/components/mcm/access-fallback";
import { EmptyState, LoadingSkeleton, MCMAvatar } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { createGroup, getOrCreateDirect } from "@/lib/api/chat";
import { updateMyConversationPreferences } from "@/lib/api/conversations";
import { sendProductCard } from "@/lib/api/product-card";
import { useRequireAuth } from "@/lib/api/guard";
import { qk, useContacts, useConversations } from "@/lib/api/queries";
import { deriveStatus, indexReceipts, listReceipts, markDelivered } from "@/lib/api/receipts";
import { waktuRelatif } from "@/lib/mcm/format";

type SendSearch = { send?: string | undefined; variant?: string | undefined };

export const Route = createFileRoute("/chat/")({
  validateSearch: (search: Record<string, unknown>): SendSearch => ({
    send: typeof search["send"] === "string" ? search["send"] : undefined,
    variant: typeof search["variant"] === "string" ? search["variant"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Chat — MCM" },
      {
        name: "description",
        content: "Semua percakapan personal dan grup MCM Anda dalam satu daftar yang rapi.",
      },
      { property: "og:title", content: "Chat — MCM" },
      { property: "og:description", content: "Percakapan personal dan grup MCM Anda." },
    ],
  }),
  component: ChatIndex,
});

const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "MC";

function ChatIndex() {
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    data: conversations,
    isLoading,
    error: conversationsError,
    refetch: refetchConversations,
  } = useConversations(userId);
  const { data: contacts } = useContacts(userId);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("semua");
  const [groupOpen, setGroupOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const { send: sendProductId, variant: sendVariantId } = Route.useSearch();
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const list = useMemo(() => {
    const all = conversations ?? [];
    const filtered = all.filter((c) =>
      c.title_resolved.toLowerCase().includes(q.trim().toLowerCase()),
    );
    if (tab === "arsip") return filtered.filter((c) => c.me.is_archived);
    const active = filtered.filter((c) => !c.me.is_archived);
    return tab === "belum" ? active.filter((c) => c.unread > 0) : active;
  }, [conversations, q, tab]);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.conversations(userId ?? "") });

  // Daftar percakapan tampil = perangkat ini menerima pesan → catat delivery
  // receipt untuk semua pesan masuk yang belum punya `delivered_at`.
  useEffect(() => {
    if (!userId || !conversations) return;
    const incoming = conversations.filter(
      (c) => c.lastMessage && c.lastMessage.sender_id !== userId,
    );
    if (incoming.length === 0) return;
    void Promise.all(incoming.map((c) => markDelivered(c.id))).then(() =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" }),
    );
  }, [userId, conversations, qc]);

  const myLastIds = useMemo(
    () =>
      (conversations ?? [])
        .filter((c) => c.lastMessage?.sender_id === userId)
        .map((c) => c.lastMessage!.id),
    [conversations, userId],
  );
  const { data: receiptRows } = useQuery({
    queryKey: ["receipts", "list", myLastIds.join(",")],
    queryFn: () => listReceipts(myLastIds, userId!),
    enabled: !!userId && myLastIds.length > 0,
  });
  const receiptIndex = useMemo(() => indexReceipts(receiptRows ?? []), [receiptRows]);

  const patchMember = async (
    conversationId: string,
    patch: { is_pinned?: boolean; is_muted?: boolean; is_archived?: boolean },
  ) => {
    try {
      await updateMyConversationPreferences(conversationId, {
        ...(patch.is_muted === undefined ? {} : { muted: patch.is_muted }),
        ...(patch.is_pinned === undefined ? {} : { pinned: patch.is_pinned }),
        ...(patch.is_archived === undefined ? {} : { archived: patch.is_archived }),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan preferensi");
      return;
    }
    void refresh();
  };

  /** Kirim kartu produk terstruktur ke percakapan yang dipilih. */
  const sendCardTo = async (conversationId: string) => {
    if (!sendProductId || !userId || sendingTo) return;
    setSendingTo(conversationId);
    try {
      await sendProductCard({
        conversationId,
        senderId: userId,
        productId: sendProductId,
        variantId: sendVariantId ?? null,
      });
      toast.success("Kartu produk terkirim");
      void navigate({ to: "/chat/$id", params: { id: conversationId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim kartu produk");
    } finally {
      setSendingTo(null);
    }
  };

  const openDirect = async (contactId: string) => {
    if (sendProductId) {
      try {
        const id = await getOrCreateDirect(contactId);
        setNewOpen(false);
        await sendCardTo(id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal membuka chat");
      }
      return;
    }
    try {
      const id = await getOrCreateDirect(contactId);
      setNewOpen(false);
      void refresh();
      void navigate({ to: "/chat/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuka chat");
    }
  };

  const submitGroup = async () => {
    if (groupName.trim().length < 3) {
      toast.error("Nama grup minimal 3 karakter");
      return;
    }
    if (groupMembers.length === 0) {
      toast.error("Pilih minimal satu anggota");
      return;
    }
    try {
      const id = await createGroup(groupName.trim(), groupMembers);
      setGroupOpen(false);
      setGroupName("");
      setGroupMembers([]);
      void refresh();
      void navigate({ to: "/chat/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat grup");
    }
  };

  return (
    <AppShell
      header={
        <MobileHeader
          title="Chat"
          actions={
            <>
              <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Buat grup" className="size-11">
                    <Users className="size-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Grup baru</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="group-name">Nama grup</Label>
                      <Input
                        id="group-name"
                        value={groupName}
                        maxLength={60}
                        onChange={(e) => setGroupName(e.target.value)}
                        placeholder="Contoh: Tim Kopi Nusa"
                      />
                    </div>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {(contacts ?? []).map((c) => (
                        <label
                          key={c.contact_id}
                          className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted"
                        >
                          <Checkbox
                            checked={groupMembers.includes(c.contact_id)}
                            onCheckedChange={(v) =>
                              setGroupMembers((p) =>
                                v ? [...p, c.contact_id] : p.filter((x) => x !== c.contact_id),
                              )
                            }
                          />
                          <UserAvatar
                            userId={c.contact_id}
                            path={c.profile.avatar_url}
                            version={c.profile.avatar_version}
                            name={c.profile.display_name}
                            color={c.profile.avatar_color}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {c.profile.display_name}
                          </span>
                        </label>
                      ))}
                      {(contacts ?? []).length === 0 && (
                        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                          Belum ada kontak.
                        </p>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button className="w-full rounded-xl" onClick={() => void submitGroup()}>
                      Buat grup
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={newOpen} onOpenChange={setNewOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Chat baru" className="size-11">
                    <MessageCirclePlus className="size-5" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>Mulai chat</DialogTitle>
                  </DialogHeader>
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {(contacts ?? [])
                      .filter((c) => !c.is_blocked)
                      .map((c) => (
                        <button
                          key={c.contact_id}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted"
                          onClick={() => void openDirect(c.contact_id)}
                        >
                          <UserAvatar
                            userId={c.contact_id}
                            path={c.profile.avatar_url}
                            version={c.profile.avatar_version}
                            name={c.profile.display_name}
                            color={c.profile.avatar_color}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {c.profile.display_name}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {c.profile.pin}
                            </span>
                          </span>
                        </button>
                      ))}
                    {(contacts ?? []).length === 0 && (
                      <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                        Tambahkan kontak lewat PIN dulu.
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="secondary"
                      className="w-full rounded-xl"
                      onClick={() => void navigate({ to: "/contacts/add" })}
                    >
                      Tambah kontak lewat PIN
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          }
        >
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={60}
                aria-label="Cari percakapan"
                placeholder="Cari percakapan"
                className="h-11 rounded-xl pl-9"
              />
            </div>
          </div>
        </MobileHeader>
      }
    >
      {sendProductId && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-primary/10 px-3 py-2 text-[13px]">
          <span className="min-w-0">Pilih percakapan tujuan kartu produk.</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => void navigate({ to: "/chat", search: {} })}
          >
            Batal
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
          <TabsTrigger value="semua">Semua</TabsTrigger>
          <TabsTrigger value="belum">Belum dibaca</TabsTrigger>
          <TabsTrigger value="arsip">Arsip</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading || isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : conversationsError ? (
        <AccessFallback
          error={conversationsError}
          onRetry={() => refetchConversations()}
          extra={
            <Button
              variant="ghost"
              className="rounded-xl"
              onClick={() => void navigate({ to: "/contacts" })}
            >
              Buka kontak
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="Belum ada percakapan"
          description="Tambahkan kontak lewat PIN MCM, lalu mulai chat pertama Anda."
          action={
            <Button className="rounded-xl" onClick={() => void navigate({ to: "/contacts/add" })}>
              Tambah kontak
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border/70">
          {list.map((c) => (
            <li key={c.id} className="relative">
              {sendProductId && (
                <button
                  type="button"
                  disabled={!!sendingTo}
                  onClick={() => void sendCardTo(c.id)}
                  aria-label={`Kirim kartu produk ke ${c.title_resolved}`}
                  className="absolute inset-0 z-10 bg-primary/0 transition-colors hover:bg-primary/10 disabled:opacity-50"
                />
              )}
              <ChatListItem
                conv={c}
                time={c.lastMessage ? waktuRelatif(c.lastMessage.created_at) : ""}
                outgoingStatus={
                  c.lastMessage && c.lastMessage.sender_id === userId
                    ? deriveStatus(
                        receiptIndex.get(c.lastMessage.id) ?? [],
                        Math.max(0, c.members.length - 1),
                      )
                    : undefined
                }
                onTogglePin={() => void patchMember(c.id, { is_pinned: !c.me.is_pinned })}
                onToggleMute={() => void patchMember(c.id, { is_muted: !c.me.is_muted })}
                onToggleArchive={() => void patchMember(c.id, { is_archived: !c.me.is_archived })}
              />
            </li>
          ))}
        </ul>
      )}

      <Button
        size="icon"
        aria-label="Buka kamera"
        className="fixed right-4 bottom-20 z-40 size-13 rounded-full shadow-lg sm:right-[max(1rem,calc(50%-13rem))]"
        onClick={() => void navigate({ to: "/photo/new" })}
      >
        <Camera className="size-5.5" />
      </Button>
    </AppShell>
  );
}
