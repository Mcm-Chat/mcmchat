import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  BellOff,
  ClipboardList,
  Info,
  Phone,
  RotateCw,
  Users,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ChatComposer, MessageBubble, type MessageAction } from "@/components/mcm/chat-parts";
import { PhotoFlow } from "@/components/mcm/photo-parts";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { ConfirmDialog, LoadingSkeleton, MCMAvatar } from "@/components/mcm/primitives";
import { AccessFallback } from "@/components/mcm/access-fallback";
import { NotificationBanner } from "@/components/mcm/notification-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelContactRequest,
  isBlockedBetween,
  sendContactRequest,
  setBlocked,
} from "@/lib/api/contacts";
import { updateMyConversationPreferences } from "@/lib/api/conversations";
import {
  deleteForEveryone,
  deleteForMe,
  editMessage,
  sendMessage,
  toggleReaction,
  type MessageRow,
} from "@/lib/api/chat";
import { deriveStatus, indexReceipts, markDelivered, markRead } from "@/lib/api/receipts";
import { getCallConfig } from "@/lib/calls/calls.functions";
import { useServerFn } from "@tanstack/react-start";
import { useRequireAuth } from "@/lib/api/guard";
import { scopedKey } from "@/lib/session-scope";
import { qk, useConversations, useMessages, useMyBusiness, useReceipts } from "@/lib/api/queries";
import { CreatePreparationDialog, PreparationJobCard } from "@/components/mcm/prepare-parts";
import { LedgerFormDialog } from "@/components/mcm/ledger-form";
import { SaleDialog } from "@/components/mcm/sale-dialog";
import { StickerPickerSheet } from "@/components/mcm/sticker-parts";
import { downloadSticker, type StickerRow } from "@/lib/api/stickers";
import { listJobsForConversation } from "@/lib/api/prepare";
import { labelHari } from "@/lib/mcm/format";
import { discardEntry, enqueueText, retryEntry, onOutboxSent, useOutbox } from "@/lib/api/outbox";
import { useConnectionState } from "@/lib/realtime/connection";
import { useBackDismiss } from "@/lib/mobile/back-guard";
import { useTyping } from "@/lib/api/presence";
import { isNearBottom, shouldAutoScroll } from "@/lib/chat/scroll";

export const Route = createFileRoute("/chat/$id")({
  validateSearch: (search: Record<string, unknown>) =>
    typeof search["hl"] === "string" ? { hl: search["hl"] } : {},
  head: () => ({
    meta: [
      { title: "Ruang Chat — MCM" },
      {
        name: "description",
        content:
          "Kirim pesan, foto berlokasi, pesan suara, dan catatan utang langsung dari ruang chat MCM.",
      },
      { property: "og:title", content: "Ruang Chat — MCM" },
      {
        property: "og:description",
        content: "Chat privat MCM dengan lampiran dan catatan keuangan.",
      },
    ],
  }),
  component: ChatRoom,
});

const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "MC";

function ChatRoom() {
  const { id } = Route.useParams();
  const search = Route.useSearch() as { hl?: string };
  const { userId, profile, onlineIds, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    data: conversations,
    error: conversationsError,
    refetch: refetchConversations,
    isLoading: convLoading,
  } = useConversations(userId);
  const {
    messages,
    isLoading,
    error: messagesError,
    refetch: refetchMessages,
    hasOlder,
    isFetchingOlder,
    fetchOlder,
  } = useMessages(id, userId);
  const conv = (conversations ?? []).find((c) => c.id === id);
  const connection = useConnectionState();
  const pending = useOutbox(id);

  const [text, setText] = useState("");
  const [reply, setReply] = useState<MessageRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [connBannerHidden, setConnBannerHidden] = useState(false);

  // Tombol Back Android menutup lapisan teratas lebih dulu (sheet/dialog/
  // mode pilih), bukan langsung meninggalkan percakapan.
  useBackDismiss(photoOpen, () => setPhotoOpen(false));
  useBackDismiss(stickerOpen, () => setStickerOpen(false));
  useBackDismiss(detailOpen, () => setDetailOpen(false));
  useBackDismiss(ledgerOpen, () => setLedgerOpen(false));
  useBackDismiss(prepOpen, () => setPrepOpen(false));
  useBackDismiss(saleOpen, () => setSaleOpen(false));
  useBackDismiss(confirmAll, () => setConfirmAll(false));
  // Prioritas eksplisit: saat dialog konfirmasi terbuka, guard selection
  // dinonaktifkan sehingga Back pertama menutup dialog, Back kedua baru
  // keluar dari mode pilih (walau kedua state di-set pada render yang sama).
  useBackDismiss(selection.length > 0 && !confirmAll, () => setSelection([]));

  const { data: business } = useMyBusiness(userId);
  const { data: prepJobs } = useQuery({
    queryKey: ["prep-jobs", id],
    queryFn: () => listJobsForConversation(id),
    enabled: !!userId,
  });

  const { data: block } = useQuery({
    queryKey: ["block", userId, conv?.other?.id],
    queryFn: () => isBlockedBetween(userId!, conv!.other!.id),
    enabled: !!userId && !!conv?.other?.id,
  });

  /**
   * Keadaan hubungan LANGSUNG dari server (bukan tebakan klien): arah
   * permintaan kontak menentukan banner. Pemohon melihat "menunggu
   * diterima", penerima melihat "Terima"/"Tolak".
   */
  const { data: relation, refetch: refetchRelation } = useQuery({
    queryKey: ["relation-state", id, userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_direct_relation_state", { _conversation: id });
      if (error) throw new Error(error.message);
      return (data ?? {}) as {
        kind?: string;
        request_id?: string | null;
        request_status?: string | null;
        request_direction?: "incoming" | "outgoing" | null;
        has_incoming_messages?: boolean;
      };
    },
    enabled: !!userId,
  });

  const { data: reactions } = useQuery({
    queryKey: ["reactions", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("message_reactions")
        .select("message_id, emoji")
        .in(
          "message_id",
          messages.map((m) => m.id),
        );
      return data ?? [];
    },
    enabled: messages.length > 0,
  });

  const myMessageIds = useMemo(
    () => messages.filter((m) => m.sender_id === userId).map((m) => m.id),
    [messages, userId],
  );
  const { data: receiptRows } = useReceipts(id, myMessageIds, userId);
  const receiptIndex = useMemo(() => indexReceipts(receiptRows ?? []), [receiptRows]);
  const otherMemberCount = useMemo(
    () => (conv?.members ?? []).filter((m) => m.id !== userId).length,
    [conv, userId],
  );

  // Membuka ruang chat = pesan masuk dibaca. Server yang menulis receipt
  // (menghormati pengaturan privasi "laporan dibaca"), lalu pengirim menerima
  // perubahan centang lewat realtime tanpa reload.
  useEffect(() => {
    if (!userId || !id) return;
    void markRead(id).then(() => {
      void qc.invalidateQueries({ queryKey: qk.conversations(userId) });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" });
    });
  }, [userId, id, messages.length, qc]);

  // Jaring pengaman bila pesan tiba saat aplikasi tidak fokus.
  useEffect(() => {
    if (!userId || !id) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void markDelivered(id).then(() => markRead(id));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, id]);

  const { typingUsers, notifyTyping } = useTyping(id, userId);

  // Auto-scroll hanya bila pengguna di dekat pesan terbaru, atau pesan terakhir
  // memang miliknya sendiri.
  const lastSenderId = messages.at(-1)?.sender_id ?? null;
  useEffect(() => {
    if (shouldAutoScroll({ atBottom, lastSenderId, userId }))
      bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending.length, atBottom, lastSenderId, userId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(isNearBottom(el));
    if (el.scrollTop < 80 && hasOlder && !isFetchingOlder) void fetchOlder();
  }, [hasOlder, isFetchingOlder, fetchOlder]);

  // Keyboard (IME) muncul/hilang: pertahankan posisi baca. Hanya menempel ke
  // dasar bila pengguna memang sedang di pesan terbaru — saat membaca riwayat
  // lama, posisi tidak dipaksa berpindah.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) return;
    const onResize = () => {
      if (!atBottom) return;
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [atBottom]);

  // Draf per percakapan bertahan saat pindah layar atau reload.
  const draftKey = scopedKey(`draft:${id}`, userId ?? null);
  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(draftKey) : null;
    if (saved) setText(saved);
  }, [draftKey]);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (text) localStorage.setItem(draftKey, text);
    else localStorage.removeItem(draftKey);
  }, [text, draftKey]);

  const nameOf = useMemo(() => {
    const map = new Map((conv?.members ?? []).map((m) => [m.id, m.display_name]));
    if (userId && profile) map.set(userId, profile.display_name);
    return (uid: string) => map.get(uid) ?? "Pengguna";
  }, [conv, userId, profile]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.messages(id) });
    void qc.invalidateQueries({ queryKey: qk.conversations(userId ?? "") });
  };

  // Saat entri outbox berhasil terkirim, muat ulang halaman pesan percakapan itu.
  useEffect(
    () =>
      onOutboxSent((entry) => {
        void qc.invalidateQueries({ queryKey: qk.messages(entry.conversationId) });
        void qc.invalidateQueries({ queryKey: qk.conversations(userId ?? "") });
      }),
    [qc, userId],
  );

  const blocked = block?.iBlocked ?? false;
  const blockedByOther = block?.blockedMe ?? false;
  // Kapabilitas berasal dari server dan dipecah per aksi: percakapan yang
  // hanya bisa dibaca tetap menampilkan riwayat, tetapi komposer dimatikan.
  // Tombol yang disembunyikan di sini tetap ditolak oleh RPC.
  const inactive = !!conv && !conv.sendable;
  const canCall = !!conv && conv.callable;

  const doSend = async () => {
    const body = text.trim();
    if (!body || !userId) return;
    if (editingId) {
      try {
        await editMessage(editingId, body);
        setEditingId(null);
        setText("");
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Pesan gagal diubah");
      }
      return;
    }
    // Pesan teks masuk outbox: tampil langsung, terkirim otomatis saat online,
    // dan tidak pernah hilang meski koneksi putus.
    enqueueText({ conversationId: id, senderId: userId, body, replyToId: reply?.id ?? null });
    setText("");
    setReply(null);
    setAtBottom(true);
  };

  const sendVoice = async (blob: Blob, seconds: number) => {
    if (!userId) return;
    try {
      await sendMessage({
        conversationId: id,
        senderId: userId,
        kind: "voice",
        file: { blob, name: "suara.webm" },
        durationSec: seconds,
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pesan suara gagal dikirim");
    }
  };

  const sendDocument = async (file: File | undefined) => {
    if (!file || !userId) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Ukuran dokumen maksimal 15 MB");
      return;
    }
    try {
      await sendMessage({
        conversationId: id,
        senderId: userId,
        kind: "document",
        file: { blob: file, name: file.name },
      });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Dokumen gagal dikirim");
    }
  };

  const sendSticker = async (sticker: StickerRow) => {
    if (!userId) return;
    try {
      const blob = await downloadSticker(sticker.path);
      await sendMessage({
        conversationId: id,
        senderId: userId,
        kind: "sticker",
        body: sticker.emoji,
        file: { blob, name: "stiker.png" },
        replyToId: reply?.id ?? null,
      });
      setReply(null);
      setAtBottom(true);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stiker gagal dikirim");
    }
  };

  const onAction = async (action: MessageAction, message: MessageRow, payload?: string) => {
    if (!userId) return;
    try {
      switch (action) {
        case "select":
          setSelection((p) =>
            p.includes(message.id) ? p.filter((x) => x !== message.id) : [...p, message.id],
          );
          break;
        case "reply":
          setReply(message);
          break;
        case "copy":
          await navigator.clipboard.writeText(message.body);
          toast.success("Pesan disalin");
          break;
        case "edit":
          setEditingId(message.id);
          setText(message.body);
          break;
        case "react":
          await toggleReaction(message.id, userId, payload ?? "👍");
          void qc.invalidateQueries({ queryKey: ["reactions", id] });
          break;
        case "delete-me":
          await deleteForMe([message.id], userId);
          refresh();
          break;
        case "delete-all":
          setSelection([message.id]);
          setConfirmAll(true);
          break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Tindakan gagal");
    }
  };

  const runDeleteForEveryone = async () => {
    if (!userId) return;
    const target = messages.filter((m) => selection.includes(m.id));
    try {
      await deleteForEveryone(target, userId);
      setSelection([]);
      setConfirmAll(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus pesan");
    }
  };

  /**
   * Segarkan semua cache yang bergantung pada hubungan kontak. Tidak pernah
   * memuat ulang halaman: cukup invalidasi query terkait.
   */
  const invalidateRelation = () => {
    void refetchRelation();
    void qc.invalidateQueries({ queryKey: ["relation-state", id] });
    void qc.invalidateQueries({ queryKey: ["block", userId, conv?.other?.id] });
    void qc.invalidateQueries({ queryKey: qk.conversations(userId ?? "") });
    void qc.invalidateQueries({ queryKey: ["contact-requests"] });
    void qc.invalidateQueries({ queryKey: ["contacts"] });
    refresh();
  };

  /**
   * Satu ketukan: server memverifikasi peserta + pesan masuk, mengunci pasangan
   * kanonik, membuat permintaan (bila belum ada) DAN menerimanya dalam satu
   * transaksi sehingga percakapan langsung bisa dibalas dan ditelepon.
   */
  const acceptLegacy = async () => {
    try {
      const { data, error } = await supabase.rpc("accept_legacy_direct_conversation", {
        _conversation: id,
      });
      if (error) throw new Error(error.message);
      const res = (data ?? {}) as { status?: string; code?: string; retry_at?: string };
      if (res.status === "waiting_for_other") {
        toast.info("Permintaan kontak Anda masih menunggu diterima.");
      } else if (res.code === "cooldown" || res.code === "rejected_by_other") {
        toast.error("Permintaan belum bisa dikirim ulang. Coba lagi nanti.");
      } else {
        toast.success("Kontak terhubung. Anda sudah bisa membalas dan menelepon.");
      }
      invalidateRelation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengaktifkan percakapan");
    }
  };

  const rejectLegacy = async () => {
    try {
      const { data, error } = await supabase.rpc("reject_legacy_direct_conversation", {
        _conversation: id,
      });
      if (error) throw new Error(error.message);
      const res = (data ?? {}) as { status?: string };
      if (res.status === "waiting_for_other") {
        toast.info("Ini permintaan Anda sendiri. Batalkan bila tidak jadi.");
      } else {
        toast.success("Permintaan ditolak");
      }
      invalidateRelation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menolak permintaan");
    }
  };

  const sendRequest = async () => {
    const other = conv?.other?.id;
    if (!other) return;
    try {
      await sendContactRequest(userId!, other, "");
      toast.success("Permintaan kontak dikirim");
      invalidateRelation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permintaan gagal dikirim");
    }
  };

  const respondRequest = async (action: "accepted" | "rejected") => {
    const requestId = relation?.request_id;
    if (!requestId) return;
    try {
      const { error } = await supabase.rpc("respond_contact_request", {
        _request: requestId,
        _action: action,
      });
      if (error) throw new Error(error.message);
      toast.success(action === "accepted" ? "Permintaan diterima" : "Permintaan ditolak");
      invalidateRelation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui permintaan");
    }
  };

  const cancelOutgoing = async () => {
    const other = conv?.other?.id;
    if (!other) return;
    try {
      await cancelContactRequest(userId!, other);
      toast.success("Permintaan dibatalkan");
      invalidateRelation();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permintaan gagal dibatalkan");
    }
  };

  const loadCallConfig = useServerFn(getCallConfig);

  const call = async (kind: "audio" | "video") => {
    if (!userId || !conv) return;
    if (!canCall) {
      toast.error(
        conv.capabilityReason === "blocked"
          ? "Kontak diblokir"
          : "Panggilan tidak tersedia untuk percakapan ini",
      );
      return;
    }
    try {
      // Jangan pernah membuat panggilan berdering bila penyedia belum
      // terhubung — lawan bicara tidak boleh menerima panggilan yang mustahil
      // tersambung.
      const cfg = await loadCallConfig().catch(() => ({ configured: false }));
      if (!cfg.configured) {
        toast.error("Penyedia panggilan belum terhubung. Hubungi admin untuk mengaktifkan.");
        return;
      }
      void navigate({
        to: "/call/prepare/$conversationId",
        params: { conversationId: id },
        search: { kind },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Panggilan gagal dimulai");
    }
  };

  const accessError = conversationsError ?? messagesError;
  if (accessError || (!loading && !convLoading && !isLoading && !conv)) {
    return (
      <AppShell nav={false} header={<MobileHeader title="Percakapan" back />}>
        <AccessFallback
          error={accessError}
          onRetry={async () => {
            await Promise.all([refetchConversations(), refetchMessages()]);
          }}
          links={["chat", "contacts", "support"]}
        />
      </AppShell>
    );
  }

  if (loading || isLoading || !conv) {
    return (
      <AppShell nav={false} header={<MobileHeader title="Memuat…" back />}>
        <LoadingSkeleton rows={6} />
      </AppShell>
    );
  }

  let lastDay = "";

  return (
    <AppShell
      nav={false}
      className="flex flex-col"
      header={
        selection.length > 0 ? (
          <MobileHeader
            title={`${selection.length} dipilih`}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void deleteForMe(selection, userId!).then(() => {
                      setSelection([]);
                      refresh();
                    })
                  }
                >
                  Hapus untuk saya
                </Button>
                {messages
                  .filter((m) => selection.includes(m.id))
                  .every((m) => m.sender_id === userId) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setConfirmAll(true)}
                  >
                    Hapus untuk semua
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Batal pilih"
                  onClick={() => setSelection([])}
                >
                  <X className="size-5" />
                </Button>
              </>
            }
          />
        ) : (
          <MobileHeader
            back
            title={
              <span className="flex items-center gap-2">
                <span className="relative shrink-0">
                  {conv.other ? (
                    <UserAvatar
                      userId={conv.other.id}
                      path={conv.other.avatar_url}
                      version={conv.other.avatar_version ?? 0}
                      name={conv.title_resolved}
                      color={conv.other.avatar_color}
                      size="sm"
                    />
                  ) : (
                    <MCMAvatar
                      initials={initialsOf(conv.title_resolved)}
                      color="#0ea5e9"
                      size="sm"
                    />
                  )}
                  {conv.other && onlineIds.has(conv.other.id) && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" />
                  )}
                </span>
                <span className="truncate">{conv.title_resolved}</span>
                {conv.me.is_muted && <BellOff className="size-3.5 text-muted-foreground" />}
              </span>
            }
            subtitle={
              typingUsers.length > 0
                ? conv.type === "group"
                  ? `${nameOf(typingUsers[0]!)} sedang mengetik…`
                  : "sedang mengetik…"
                : conv.type === "group"
                  ? `${conv.members.length} anggota`
                  : conv.other && onlineIds.has(conv.other.id)
                    ? "Online sekarang"
                    : (conv.other?.pin ?? "")
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Panggilan suara"
                  disabled={inactive || blocked || blockedByOther}
                  onClick={() => void call("audio")}
                >
                  <Phone className="size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Panggilan video"
                  disabled={inactive || blocked || blockedByOther}
                  onClick={() => void call("video")}
                >
                  <Video className="size-5" />
                </Button>
                {business && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Buat perintah penyiapan"
                    onClick={() => setPrepOpen(true)}
                  >
                    <ClipboardList className="size-5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Detail chat"
                  onClick={() => setDetailOpen(true)}
                >
                  <Info className="size-5" />
                </Button>
              </>
            }
          />
        )
      }
    >
      {connection !== "online" && !connBannerHidden && (
        <NotificationBanner
          onDismiss={() => setConnBannerHidden(true)}
          dismissLabel="Tutup info koneksi"
          className="sticky top-0 z-10 items-center bg-muted/90 px-4 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur"
        >
          <span className="block text-center">
            {connection === "connecting"
              ? "Menghubungkan kembali…"
              : "Offline — pesan dikirim otomatis saat koneksi kembali"}
          </span>
        </NotificationBanner>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-canvas relative flex-1 overflow-y-auto px-2 py-3"
      >
        {hasOlder && (
          <div className="mb-2 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={isFetchingOlder}
              onClick={() => void fetchOlder()}
            >
              {isFetchingOlder ? "Memuat pesan lama…" : "Muat pesan lama"}
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex min-h-[45vh] flex-col items-center justify-center gap-2 px-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {conv.other ? (
                <UserAvatar
                  userId={conv.other.id}
                  path={conv.other.avatar_url}
                  version={conv.other.avatar_version ?? 0}
                  name={conv.title_resolved}
                  color={conv.other.avatar_color}
                />
              ) : (
                <MCMAvatar initials={initialsOf(conv.title_resolved)} color="#0ea5e9" />
              )}
            </span>
            <p className="text-sm font-semibold">Mulai percakapan dengan {conv.title_resolved}</p>
            <p className="text-xs text-muted-foreground">
              Kirim pesan, foto berlokasi, atau catatan keuangan langsung dari sini.
            </p>
          </div>
        )}
        {messages.map((m, idx) => {
          const day = labelHari(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.sender_id === userId;
          const replyTo = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : undefined;
          const status = deriveStatus(receiptIndex.get(m.id) ?? [], otherMemberCount);
          const prev = messages[idx - 1];
          const grouped =
            !showDay &&
            !!prev &&
            prev.sender_id === m.sender_id &&
            prev.kind !== "system" &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 4 * 60 * 1000;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full border border-border/60 bg-card/80 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-xs backdrop-blur">
                    {day}
                  </span>
                </div>
              )}
              <MessageBubble
                message={m}
                replyTo={replyTo}
                replySenderName={replyTo ? nameOf(replyTo.sender_id) : undefined}
                senderName={nameOf(m.sender_id)}
                mine={mine}
                showSender={conv.type !== "direct"}
                reactions={(reactions ?? [])
                  .filter((r) => r.message_id === m.id)
                  .map((r) => r.emoji)}
                status={status}
                grouped={grouped}
                selectable={selection.length > 0}
                selected={selection.includes(m.id)}
                highlighted={search.hl === m.id}
                onAction={(a, msg, p) => void onAction(a, msg, p)}
              />
            </div>
          );
        })}

        {/* Pesan yang masih di outbox: tampil optimistis, tidak pernah hilang. */}
        {pending.map((entry) => (
          <div key={entry.clientId} className="mb-1.5 flex justify-end px-2">
            <div
              className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                entry.status === "failed"
                  ? "border border-destructive/40 bg-destructive/10"
                  : "bg-primary/70 text-primary-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{entry.body}</p>
              <div className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-80">
                {entry.status === "failed" ? (
                  <>
                    <span className="text-destructive">Gagal terkirim</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium text-destructive underline"
                      onClick={() => retryEntry(entry.clientId)}
                    >
                      <RotateCw className="size-3" /> Coba lagi
                    </button>
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => discardEntry(entry.clientId)}
                    >
                      Buang
                    </button>
                  </>
                ) : (
                  <span>Mengirim…</span>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!atBottom && (
        <div className="pointer-events-none sticky bottom-24 z-10 flex justify-end px-4">
          <Button
            size="icon"
            variant="secondary"
            aria-label="Lompat ke pesan terbaru"
            className="pointer-events-auto rounded-full shadow-md"
            onClick={() => {
              setAtBottom(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }}
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
      )}

      {inactive && !blocked && !blockedByOther ? (
        <div className="sticky bottom-0 space-y-3 border-t border-border bg-card px-4 py-4 text-center">
          {relation?.request_status === "pending" && relation.request_direction === "outgoing" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {`Permintaan kontak sudah dikirim ke ${conv.other?.display_name ?? "kontak ini"}. Menunggu diterima.`}
              </p>
              <Button variant="secondary" className="rounded-xl" onClick={() => void cancelOutgoing()}>
                Batalkan permintaan
              </Button>
            </>
          ) : relation?.request_status === "pending" && relation.request_direction === "incoming" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {`${conv.other?.display_name ?? "Kontak ini"} ingin terhubung dengan Anda.`}
              </p>
              <div className="flex justify-center gap-2">
                <Button className="rounded-xl" onClick={() => void respondRequest("accepted")}>
                  Terima
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  onClick={() => void respondRequest("rejected")}
                >
                  Tolak
                </Button>
              </div>
            </>
          ) : relation?.has_incoming_messages ? (
            <>
              <p className="text-sm text-muted-foreground">
                {`${conv.other?.display_name ?? "Kontak ini"} pernah mengirim pesan ke Anda. Terima untuk mulai membalas.`}
              </p>
              <div className="flex justify-center gap-2">
                <Button className="rounded-xl" onClick={() => void acceptLegacy()}>
                  Terima percakapan &amp; hubungkan
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  onClick={() => void rejectLegacy()}
                >
                  Tolak
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Hubungan kontak tidak aktif. Riwayat percakapan tetap dapat dibaca.
              </p>
              <Button variant="secondary" className="rounded-xl" onClick={() => void sendRequest()}>
                Kirim permintaan
              </Button>
            </>
          )}
        </div>
      ) : blocked || blockedByOther ? (
        <div className="sticky bottom-0 space-y-2 border-t border-border bg-card px-4 py-4 text-center">
          <p className="text-sm text-muted-foreground">
            {blocked
              ? `Anda memblokir ${conv.other?.display_name ?? "kontak ini"}.`
              : "Anda tidak dapat mengirim pesan ke kontak ini."}
          </p>
          {blocked && (
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={() =>
                void setBlocked(userId!, conv.other!.id, false).then(() => {
                  void qc.invalidateQueries({ queryKey: ["block", userId, conv.other?.id] });
                  toast.success("Blokir dibuka");
                })
              }
            >
              Buka blokir
            </Button>
          )}
        </div>
      ) : (
        <ChatComposer
          value={text}
          onChange={(v) => {
            setText(v);
            if (v) notifyTyping();
          }}
          onSend={doSend}
          onAttach={(kind) => (kind === "document" ? docRef.current?.click() : setPhotoOpen(true))}
          onVoice={(blob, sec) => void sendVoice(blob, sec)}
          onNewLedger={() => setLedgerOpen(true)}
          onNewSale={business ? () => setSaleOpen(true) : undefined}
          onNewPreparation={business ? () => setPrepOpen(true) : undefined}
          onLocation={() => setPhotoOpen(true)}
          onSticker={() => setStickerOpen(true)}
          editing={!!editingId}
          onCancelEdit={() => {
            setEditingId(null);
            setText("");
          }}
          replyPreview={reply ?? undefined}
          replySenderName={reply ? nameOf(reply.sender_id) : undefined}
          onCancelReply={() => setReply(null)}
        />
      )}

      <input
        ref={docRef}
        type="file"
        hidden
        onChange={(e) => {
          void sendDocument(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {userId && (
        <StickerPickerSheet
          open={stickerOpen}
          onOpenChange={setStickerOpen}
          userId={userId}
          onPick={(s) => void sendSticker(s)}
        />
      )}

      <Sheet open={photoOpen} onOpenChange={setPhotoOpen}>
        <SheetContent side="bottom" className="h-[92dvh] rounded-t-3xl p-0">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Kirim foto ke {conv.title_resolved}</SheetTitle>
          </SheetHeader>
          {userId && (
            <PhotoFlow
              userId={userId}
              conversations={conversations ?? []}
              fixedConversationIds={[id]}
              onCancel={() => setPhotoOpen(false)}
              onDone={() => {
                setPhotoOpen(false);
                refresh();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Detail percakapan</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6">
            <div className="flex items-center gap-2 text-sm">
              <Users className="size-4 text-muted-foreground" /> {conv.members.length} anggota
            </div>
            <ul className="space-y-1">
              {conv.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <UserAvatar
                    userId={m.id}
                    path={m.avatar_url}
                    version={m.avatar_version ?? 0}
                    name={m.display_name}
                    color={m.avatar_color}
                    size="xs"
                  />
                  <span className="truncate">{m.display_name}</span>
                  {m.pin ? (
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {m.pin}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {(prepJobs ?? []).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  Perintah penyiapan percakapan ini
                </p>
                {(prepJobs ?? []).map((job) => (
                  <PreparationJobCard
                    key={job.id}
                    job={job}
                    onChanged={() => void qc.invalidateQueries({ queryKey: ["prep-jobs", id] })}
                  />
                ))}
              </div>
            )}
            <Button
              variant="secondary"
              className="w-full rounded-xl"
              onClick={() =>
                void updateMyConversationPreferences(id, { muted: !conv.me.is_muted })
                  .then(() => {
                    void qc.invalidateQueries({ queryKey: qk.conversations(userId ?? "") });
                  })
                  .catch((err: unknown) =>
                    toast.error(err instanceof Error ? err.message : "Gagal menyimpan preferensi"),
                  )
              }
            >
              {conv.me.is_muted ? "Bunyikan notifikasi" : "Bisukan notifikasi"}
            </Button>
            {conv.other && (
              <Button
                variant="outline"
                className="w-full rounded-xl text-destructive"
                onClick={() =>
                  void setBlocked(userId!, conv.other!.id, !blocked).then(() => {
                    void qc.invalidateQueries({ queryKey: ["block", userId, conv.other?.id] });
                    setDetailOpen(false);
                  })
                }
              >
                {blocked ? "Buka blokir kontak" : "Blokir kontak"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {userId && conv && (
        <LedgerFormDialog
          open={ledgerOpen}
          onOpenChange={setLedgerOpen}
          ownerId={userId}
          preset={{
            counterpartUserId: conv.other?.id ?? null,
            counterpartName: conv.other?.display_name ?? conv.title_resolved,
            conversationId: id,
          }}
          onCreated={async (entry) => {
            await sendMessage({
              conversationId: id,
              senderId: userId,
              kind: "ledger",
              body: `Catatan ${entry.type === "receivable" ? "piutang" : "utang"} Rp${Number(entry.amount).toLocaleString("id-ID")} menunggu persetujuan`,
              payload: { ledgerId: entry.id },
            });
            refresh();
          }}
        />
      )}

      {business && userId && (
        <SaleDialog
          open={saleOpen}
          onOpenChange={setSaleOpen}
          businessId={business.business.id}
          sellerId={userId}
          conversationId={id}
          customerUserId={conv.other?.id ?? null}
          customerName={conv.other?.display_name ?? conv.title_resolved}
          onSuccess={() => refresh()}
        />
      )}

      {business && userId && (
        <CreatePreparationDialog
          open={prepOpen}
          onOpenChange={setPrepOpen}
          businessId={business.business.id}
          conversationId={id}
          customerName={conv.other?.display_name ?? conv.title_resolved}
          customerUserId={conv.other?.id ?? null}
          onCreated={(job) => {
            void qc.invalidateQueries({ queryKey: ["prep-jobs", id] });
            setDetailOpen(true);
            toast.success(`Tugas ${job.code} dikirim. Barcode siap dipindai pegawai.`);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Hapus untuk semua?"
        description="Pesan hilang sepenuhnya dari kedua sisi tanpa meninggalkan jejak atau teks pengganti."
        confirmLabel="Hapus untuk semua"
        destructive
        onConfirm={() => void runDeleteForEveryone()}
      />
    </AppShell>
  );
}
