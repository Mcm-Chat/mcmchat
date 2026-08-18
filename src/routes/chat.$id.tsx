import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Search as SearchIcon,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  BellOff,
  ClipboardList,
  Info,
  MailOpen,
  CheckCheck,
  MoreVertical,
  Pencil,
  Phone,
  RotateCw,
  Users,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { RenameContactDialog } from "@/components/mcm/rename-contact-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useContactAliases } from "@/lib/contacts/alias";
import { MessageBubble, type MessageAction } from "@/components/mcm/chat-parts";
import { ComposerHost, type ComposerHandle } from "@/components/mcm/composer-host";
import { ForwardDialog } from "@/components/mcm/lazy-heavy";
import { TypingIndicator } from "@/components/mcm/typing-indicator";
import { LocationShareFlow, PhotoFlow } from "@/components/mcm/photo-parts";
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
import { LedgerFormDialog } from "@/components/mcm/lazy-heavy";
import { SaleDialog } from "@/components/mcm/lazy-heavy";
import { StickerPickerSheet } from "@/components/mcm/sticker-parts";
import { downloadSticker, type StickerRow } from "@/lib/api/stickers";
import { listJobsForConversation } from "@/lib/api/prepare";
import { labelHari } from "@/lib/mcm/format";
import { discardEntry, enqueueText, retryEntry, onOutboxSent, useOutbox } from "@/lib/api/outbox";
import { useConnectionState } from "@/lib/realtime/connection";
import { useBackDismiss } from "@/lib/mobile/back-guard";
import { useTyping } from "@/lib/api/presence";
import {
  isNearBottom,
  isUserScrolling,
  shouldAutoScroll,
  keyboardScrollAction,
  pickScrollAnchor,
  anchorScrollDelta,
  USER_SCROLL_GRACE_MS,
} from "@/lib/chat/scroll";
import {
  clearChatView,
  loadChatView,
  saveChatView,
  shouldRestoreScroll,
} from "@/lib/chat/scroll-restore";
import { summarizeUnread } from "@/lib/chat/unread";
import {
  READ_SETTLE_MS,
  advanceReadBaseline,
  lastVisibleIndex,
  settledBaseline,
} from "@/lib/chat/read-settle";

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
  const { nameOf: contactNameOf } = useContactAliases();
  // Nama tampilan chat mengikuti nama kontak yang saya simpan sendiri.
  const headerName = contactNameOf(conv?.other?.id, conv?.title_resolved ?? "Percakapan");
  // Antrian chat yang masih belum dibaca untuk tombol "Unread berikutnya".
  const unreadQueue = useMemo(
    () =>
      (conversations ?? [])
        .filter((c) => !c.me.is_archived && c.unread > 0)
        .sort(
          (a, b) =>
            b.unread - a.unread ||
            (new Date(b.updated_at).getTime() || 0) - (new Date(a.updated_at).getTime() || 0),
        ),
    [conversations],
  );
  const nextUnread = useMemo(() => {
    const idx = unreadQueue.findIndex((c) => c.id === id);
    if (idx === -1) return unreadQueue[0] ?? null;
    return unreadQueue[idx + 1] ?? null;
  }, [unreadQueue, id]);
  const remainingUnreadCount = useMemo(
    () => Math.max(0, unreadQueue.length - (unreadQueue.findIndex((c) => c.id === id) + 1)),
    [unreadQueue, id],
  );
  const connection = useConnectionState();
  const pending = useOutbox(id);

  const [reply, setReply] = useState<MessageRow | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [forwarding, setForwarding] = useState<MessageRow[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoMode, setPhotoMode] = useState<"camera" | "gallery">("camera");
  const [locationOpen, setLocationOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Waktu interaksi gulir/sentuh terakhir: dipakai untuk menahan auto-scroll
  // selama jari (atau momentum) masih menggerakkan daftar.
  const lastInteractionRef = useRef(0);
  const [missedCount, setMissedCount] = useState(0);
  const lastMessageIdRef = useRef<string | null>(null);
  // Baseline "terakhir dibaca" dibekukan saat ruang dibuka, sebelum server
  // menandai pesan sebagai dibaca — supaya penanda pertama-belum-dibaca stabil.
  const readBaselineRef = useRef<string | null | undefined>(undefined);
  const [unreadDismissed, setUnreadDismissed] = useState(false);
  /** Sorotan sementara pada pesan belum dibaca setelah tombol ditekan. */
  const [unreadMarked, setUnreadMarked] = useState(false);
  const [connBannerHidden, setConnBannerHidden] = useState(false);
  // Pemulihan posisi baca & fokus komposer saat chat yang sama dibuka lagi.
  const restoreRef = useRef<ReturnType<typeof loadChatView> | null | undefined>(undefined);
  const restoredRef = useRef(false);
  const composerFocusedRef = useRef(false);
  if (restoreRef.current === undefined) restoreRef.current = loadChatView(id);

  // Tombol Back Android menutup lapisan teratas lebih dulu (sheet/dialog/
  // mode pilih), bukan langsung meninggalkan percakapan.
  useBackDismiss(photoOpen, () => setPhotoOpen(false));
  useBackDismiss(locationOpen, () => setLocationOpen(false));
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

  /**
   * Meta baris dihitung sekali per daftar pesan (pemisah hari + pengelompokan),
   * bukan saat render berurutan — syarat agar daftar bisa divirtualisasi.
   */
  const rows = useMemo(() => {
    let lastDayLabel = "";
    return messages.map((m, idx) => {
      const day = labelHari(m.created_at);
      const showDay = day !== lastDayLabel;
      lastDayLabel = day;
      const prev = messages[idx - 1];
      const grouped =
        !showDay &&
        !!prev &&
        prev.sender_id === m.sender_id &&
        prev.kind !== "system" &&
        new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 4 * 60 * 1000;
      return { message: m, day, showDay, grouped };
    });
  }, [messages]);

  // Virtualisasi: hanya bubble di sekitar viewport yang benar-benar dirender,
  // tinggi tiap baris diukur nyata agar foto/kartu tidak bikin lompatan.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 84,
    getItemKey: (index) => rows[index]?.message.id ?? index,
    // Tiap baris dipasangi ResizeObserver oleh measureElement; overscan besar
    // berarti puluhan observer aktif dan biaya ukur ulang tiap frame gulir.
    overscan: 6,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Jangkar posisi baca: baris pertama yang terlihat. Saat tinggi baris di atas
  // viewport berubah (gambar selesai dimuat, balasan terbuka), scrollTop
  // dikoreksi sebesar perubahannya supaya daftar tidak loncat.
  const anchorRef = useRef<import("@/lib/chat/scroll").ScrollAnchor | null>(null);
  const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el) return;
    if (isNearBottom(el)) {
      anchorRef.current = null;
      return;
    }
    // Selama jari/momentum masih menggerakkan daftar, jangan pernah
    // mengoreksi scrollTop: koreksi jangkar akan melawan gulir pengguna dan
    // menarik daftar balik ke atas.
    if (isUserScrolling(lastInteractionRef.current)) {
      anchorRef.current = pickScrollAnchor(virtualItems, el.scrollTop);
      return;
    }
    if (!anchor) {
      anchorRef.current = pickScrollAnchor(virtualItems, el.scrollTop);
      return;
    }
    const next = virtualizer.measurementsCache[anchor.index]?.start;
    const delta = anchorScrollDelta(anchor, next);
    // Koreksi hanya untuk perubahan tinggi yang wajar; lompatan besar berarti
    // jangkar sudah basi (mis. daftar dipangkas) dan harus diambil ulang.
    if (delta !== 0 && Math.abs(delta) <= 2000) {
      el.scrollTop += delta;
      anchor.start = next as number;
    } else if (delta !== 0) {
      anchorRef.current = pickScrollAnchor(virtualItems, el.scrollTop);
    }
  });

  // Pesan yang disorot dari pencarian bisa berada di luar jendela virtual —
  // gulirkan ke indeksnya begitu pesan tersedia.
  const hl = search.hl;
  useEffect(() => {
    if (!hl) return;
    const idx = rows.findIndex((r) => r.message.id === hl);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "center" });
  }, [hl, rows, virtualizer]);

  // ——— Pencarian di dalam percakapan ———
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const matchIndexes = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (q.length < 2) return [] as number[];
    const out: number[] = [];
    rows.forEach((r, idx) => {
      const body = (r.message.body ?? "").toLowerCase();
      if (body.includes(q)) out.push(idx);
    });
    return out;
  }, [rows, searchTerm]);

  useEffect(() => {
    setMatchCursor(matchIndexes.length > 0 ? matchIndexes.length - 1 : 0);
  }, [matchIndexes.length, searchTerm]);

  const activeMatchIndex = matchIndexes[matchCursor];
  const activeMatchId =
    activeMatchIndex === undefined ? null : (rows[activeMatchIndex]?.message.id ?? null);

  useEffect(() => {
    if (!searchOpen || activeMatchIndex === undefined) return;
    virtualizer.scrollToIndex(activeMatchIndex, { align: "center" });
  }, [searchOpen, activeMatchIndex, virtualizer]);

  const stepMatch = useCallback(
    (dir: 1 | -1) => {
      if (matchIndexes.length === 0) return;
      setMatchCursor((c) => (c + dir + matchIndexes.length) % matchIndexes.length);
    },
    [matchIndexes.length],
  );

  // Auto-scroll hanya bila pengguna di dekat pesan terbaru, atau pesan terakhir
  // memang miliknya sendiri.
  const lastSenderId = messages.at(-1)?.sender_id ?? null;
  // Kunci scroll manual (persisten per percakapan): saat aktif, daftar tidak
  // pernah menyeret pengguna ke pesan terbaru — bahkan untuk pesan sendiri.
  const lockKey = `mcm.chat.scrollLock.${id}`;
  const [scrollLocked, setScrollLocked] = useState(false);
  useEffect(() => {
    try {
      setScrollLocked(localStorage.getItem(lockKey) === "1");
    } catch {
      setScrollLocked(false);
    }
  }, [lockKey]);
  const toggleScrollLock = useCallback(() => {
    setScrollLocked((prev) => {
      const next = !prev;
      try {
        if (next) localStorage.setItem(lockKey, "1");
        else localStorage.removeItem(lockKey);
      } catch {
        /* storage tidak tersedia */
      }
      return next;
    });
  }, [lockKey]);
  // Dengan daftar virtual, tinggi baris di luar viewport masih perkiraan —
  // gulir ke indeks terakhir dulu, baru rapatkan ke sentinel dasar.
  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const last = messages.length - 1;
      if (last >= 0) virtualizer.scrollToIndex(last, { align: "end" });
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior, block: "end" }));
    },
    [messages.length, virtualizer],
  );

  // Ringkasan pesan belum dibaca (baseline dibekukan saat percakapan dibuka).
  if (readBaselineRef.current === undefined && conv) {
    readBaselineRef.current = conv.me.last_read_at ?? null;
  }
  // Baseline maju sendiri saat pengguna benar-benar selesai membaca satu area.
  const [settledBaselineAt, setSettledBaselineAt] = useState<string | null>(null);
  const effectiveBaseline = advanceReadBaseline(
    readBaselineRef.current ?? null,
    settledBaselineAt,
  );
  const unread = useMemo(
    () =>
      summarizeUnread(
        messages.map((m) => ({
          id: m.id,
          sender_id: m.sender_id,
          created_at: m.created_at,
          kind: m.kind,
        })),
        userId ?? null,
        effectiveBaseline,
      ),
    [messages, userId, effectiveBaseline],
  );
  // Pemicu 1: berhenti menggulir → area yang terlihat dianggap terbaca.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markVisibleAsRead = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = lastVisibleIndex(virtualizer.getVirtualItems(), el.scrollTop, el.clientHeight);
    setSettledBaselineAt((prev) =>
      settledBaseline(
        messages,
        idx,
        advanceReadBaseline(readBaselineRef.current ?? null, prev),
      ),
    );
  }, [messages, virtualizer]);
  const scheduleReadSettle = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(markVisibleAsRead, READ_SETTLE_MS);
  }, [markVisibleAsRead]);
  useEffect(() => {
    scheduleReadSettle();
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, [scheduleReadSettle, messages.length]);
  const jumpToFirstUnread = useCallback(() => {
    if (unread.firstIndex < 0) return;
    // Pemicu 2: melompat ke blok belum dibaca = blok itu dianggap terbaca.
    const lastUnreadAt = messages.at(-1)?.created_at ?? null;
    setUnreadDismissed(true);
    // Sorotan visual: pesan belum dibaca ditandai sementara agar posisinya jelas.
    setUnreadMarked(true);
    virtualizer.scrollToIndex(unread.firstIndex, { align: "start" });
    requestAnimationFrame(() => virtualizer.scrollToIndex(unread.firstIndex, { align: "start" }));
    setSettledBaselineAt((prev) =>
      advanceReadBaseline(advanceReadBaseline(readBaselineRef.current ?? null, prev), lastUnreadAt),
    );
  }, [unread.firstIndex, virtualizer, messages]);
  // Tandai semua sebagai dibaca: badge hilang seketika (lokal) lalu server
  // menyusul menulis receipt agar pengirim ikut melihat centang biru.
  const markAllAsRead = useCallback(() => {
    const latest = messages.at(-1)?.created_at ?? new Date().toISOString();
    setSettledBaselineAt((prev) =>
      advanceReadBaseline(advanceReadBaseline(readBaselineRef.current ?? null, prev), latest),
    );
    setUnreadDismissed(true);
    setUnreadMarked(false);
    setMissedCount(0);
    if (!id) return;
    void markRead(id).then(() => {
      if (userId) void qc.invalidateQueries({ queryKey: qk.conversations(userId) });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "receipts" });
    });
  }, [messages, id, userId, qc]);
  // Sorotan memudar sendiri agar tidak mengganggu pembacaan selanjutnya.
  useEffect(() => {
    if (!unreadMarked) return;
    const t = setTimeout(() => setUnreadMarked(false), 8000);
    return () => clearTimeout(t);
  }, [unreadMarked]);
  const markedIds = useMemo(
    () => (unreadMarked ? new Set(unread.ids) : null),
    [unreadMarked, unread.ids],
  );
  useEffect(() => {
    const lastId = messages.at(-1)?.id ?? null;
    const grew = lastId !== null && lastId !== lastMessageIdRef.current;
    lastMessageIdRef.current = lastId;
    // Selama posisi tersimpan belum dipulihkan, jangan paksa turun ke dasar.
    if (!restoredRef.current && shouldRestoreScroll(restoreRef.current ?? null)) return;
    const auto = shouldAutoScroll({
      atBottom,
      lastSenderId,
      userId,
      userScrolling: isUserScrolling(lastInteractionRef.current),
      locked: scrollLocked,
    });
    if (auto) {
      setMissedCount(0);
      scrollToLatest();
    } else if (grew && lastSenderId !== userId) {
      // Pesan masuk saat pengguna membaca riwayat: jangan loncat, cukup hitung.
      setMissedCount((n) => n + 1);
    }
  }, [
    messages.length,
    pending.length,
    atBottom,
    lastSenderId,
    userId,
    scrollToLatest,
    messages,
    scrollLocked,
  ]);

  // Scroll handler di-throttle ke satu frame agar gulir jari tetap mulus:
  // setState tidak pernah dipanggil per event scroll.
  const scrollTick = useRef(false);
  const onScroll = useCallback(() => {
    if (scrollTick.current) return;
    scrollTick.current = true;
    requestAnimationFrame(() => {
      scrollTick.current = false;
      const el = scrollRef.current;
      if (!el) return;
      setAtBottom((prev) => {
        const next = isNearBottom(el);
        if (next && !prev) setMissedCount(0);
        return next === prev ? prev : next;
      });
      // Perbarui jangkar mengikuti posisi baca terbaru pengguna.
      anchorRef.current = isNearBottom(el)
        ? null
        : pickScrollAnchor(virtualizer.getVirtualItems(), el.scrollTop);
      // Tandai dibaca hanya setelah gulir benar-benar berhenti di area ini.
      scheduleReadSettle();
      if (el.scrollTop < 80 && hasOlder && !isFetchingOlder) void fetchOlder();
    });
  }, [hasOlder, isFetchingOlder, fetchOlder, virtualizer, scheduleReadSettle]);

  // Pulihkan posisi baca terakhir sekali daftar pertama sudah terpasang.
  useEffect(() => {
    if (restoredRef.current) return;
    const saved = restoreRef.current ?? null;
    if (!shouldRestoreScroll(saved)) {
      restoredRef.current = true;
      return;
    }
    if (messages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    restoredRef.current = true;
    const apply = () => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = Math.min(saved.top, node.scrollHeight - node.clientHeight);
      setAtBottom(isNearBottom(node));
    };
    apply();
    // Ulangi setelah tinggi baris virtual terukur agar posisi tidak melenceng.
    const t = window.setTimeout(apply, 120);
    if (saved.composerFocused) window.setTimeout(() => composerRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, [messages.length]);

  // Simpan posisi & fokus saat meninggalkan layar (pindah rute, tab ke latar,
  // atau aplikasi ditutup) supaya bisa dipulihkan saat chat dibuka lagi.
  useEffect(() => {
    const persist = () => {
      const el = scrollRef.current;
      if (!el) return;
      const bottom = isNearBottom(el);
      if (bottom && !composerFocusedRef.current) {
        clearChatView(id);
        return;
      }
      saveChatView(id, {
        top: el.scrollTop,
        atBottom: bottom,
        composerFocused: composerFocusedRef.current,
      });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", persist);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [id]);

  // Keyboard (IME) muncul/hilang: pertahankan posisi baca. Hanya menempel ke
  // dasar bila pengguna memang sedang di pesan terbaru — saat membaca riwayat
  // lama, posisi tidak dipaksa berpindah.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!vv) return;
    let prevHeight = vv.height;
    const onResize = () => {
      const el = scrollRef.current;
      const nextHeight = vv.height;
      const action = keyboardScrollAction({
        prevHeight,
        nextHeight,
        atBottom,
        locked: scrollLocked,
      });
      prevHeight = nextHeight;
      if (!el || action.type === "none") return;
      if (action.type === "stick") {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
        return;
      }
      // Membaca riwayat lama: geser balik sebesar perubahan tinggi layar agar
      // baris yang sedang dibaca tetap di posisi yang sama.
      const apply = () => {
        const node = scrollRef.current;
        if (!node) return;
        const max = Math.max(0, node.scrollHeight - node.clientHeight);
        node.scrollTop = Math.min(Math.max(0, node.scrollTop + action.delta), max);
      };
      apply();
      requestAnimationFrame(apply);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [atBottom, scrollLocked]);

  // Draf per percakapan bertahan saat pindah layar atau reload; state teksnya
  // hidup di dalam ComposerHost supaya mengetik tidak me-render ulang daftar.
  const draftKey = scopedKey(`draft:${id}`, userId ?? null);

  const nameOf = useMemo(() => {
    const map = new Map((conv?.members ?? []).map((m) => [m.id, m.display_name]));
    if (userId && profile) map.set(userId, profile.display_name);
    return (uid: string) => map.get(uid) ?? "Pengguna";
  }, [conv, userId, profile]);

  // Indeks O(1): tanpa ini setiap bubble melakukan find/filter linear sehingga
  // render daftar panjang menjadi kuadratik dan terasa berat di ponsel.
  const messageById = useMemo(() => {
    const map = new Map<string, MessageRow>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of reactions ?? []) {
      const list = map.get(r.message_id);
      if (list) list.push(r.emoji);
      else map.set(r.message_id, [r.emoji]);
    }
    return map;
  }, [reactions]);
  const EMPTY_REACTIONS = useMemo<string[]>(() => [], []);

  // Handler stabil supaya React.memo pada MessageBubble benar-benar bekerja.
  const actionRef = useRef<(a: MessageAction, m: MessageRow, p?: string) => void>(() => {});
  const handleAction = useCallback((a: MessageAction, m: MessageRow, p?: string) => {
    actionRef.current(a, m, p);
  }, []);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.messages(id) });
    void qc.invalidateQueries({ queryKey: qk.conversations(userId ?? "") });
  };

  const openNextUnread = useCallback(() => {
    if (!nextUnread) {
      toast.info("Tidak ada chat belum dibaca lainnya");
      return;
    }
    void navigate({ to: "/chat/$id", params: { id: nextUnread.id } });
  }, [nextUnread, navigate]);

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
  actionRef.current = (a, m, p) => void onAction(a, m, p);
  const blockedByOther = block?.blockedMe ?? false;
  // Kapabilitas berasal dari server dan dipecah per aksi: percakapan yang
  // hanya bisa dibaca tetap menampilkan riwayat, tetapi komposer dimatikan.
  // Tombol yang disembunyikan di sini tetap ditolak oleh RPC.
  const inactive = !!conv && !conv.sendable;
  const canCall = !!conv && conv.callable;

  const doSend = async (raw: string) => {
    const body = raw.trim();
    if (!body || !userId) return;
    if (editingId) {
      try {
        await editMessage(editingId, body);
        setEditingId(null);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Pesan gagal diubah");
      }
      return;
    }
    // Pesan teks masuk outbox: tampil langsung, terkirim otomatis saat online,
    // dan tidak pernah hilang meski koneksi putus.
    enqueueText({ conversationId: id, senderId: userId, body, replyToId: reply?.id ?? null });
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
        case "forward":
          setForwarding([message]);
          break;
        case "copy":
          await navigator.clipboard.writeText(message.body);
          toast.success("Pesan disalin");
          break;
        case "edit":
          setEditingId(message.id);
          composerRef.current?.setText(message.body);
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
                  onClick={() => setForwarding(messages.filter((m) => selection.includes(m.id)))}
                >
                  Teruskan
                </Button>
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
              <span className="flex min-w-0 items-center gap-2">
                <span className="relative shrink-0">
                  {conv.other ? (
                    <UserAvatar
                      userId={conv.other.id}
                      path={conv.other.avatar_url}
                      version={conv.other.avatar_version ?? 0}
                      name={headerName}
                      color={conv.other.avatar_color}
                      size="sm"
                    />
                  ) : (
                    <MCMAvatar initials={initialsOf(headerName)} color="#0ea5e9" size="sm" />
                  )}
                  {conv.other && onlineIds.has(conv.other.id) && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" />
                  )}
                </span>
                <span className="min-w-0 truncate">{headerName}</span>
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
                  className="size-9"
                  aria-label="Panggilan suara"
                  disabled={inactive || blocked || blockedByOther}
                  onClick={() => void call("audio")}
                >
                  <Phone className="size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  aria-label="Panggilan video"
                  disabled={inactive || blocked || blockedByOther}
                  onClick={() => void call("video")}
                >
                  <Video className="size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  aria-label="Cari pesan di percakapan ini"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                >
                  <SearchIcon className="size-5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative size-9"
                      aria-label="Menu percakapan"
                    >
                      <MoreVertical className="size-5" />
                      {remainingUnreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                          {remainingUnreadCount > 99 ? "99+" : remainingUnreadCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-xl">
                    <DropdownMenuItem onSelect={() => setDetailOpen(true)}>
                      <Info className="size-4" />
                      Detail chat
                    </DropdownMenuItem>
                    {conv.other && (
                      <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                        <Pencil className="size-4" />
                        Ubah nama kontak
                      </DropdownMenuItem>
                    )}
                    {business && (
                      <DropdownMenuItem onSelect={() => setPrepOpen(true)}>
                        <ClipboardList className="size-4" />
                        Perintah penyiapan
                      </DropdownMenuItem>
                    )}
                    {unreadQueue.length > 0 && (
                      <DropdownMenuItem
                        disabled={!nextUnread}
                        onSelect={() => void openNextUnread()}
                      >
                        <ArrowRight className="size-4" />
                        <span className="min-w-0 flex-1 truncate">Unread berikutnya</span>
                        {remainingUnreadCount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {remainingUnreadCount > 99 ? "99+" : remainingUnreadCount}
                          </span>
                        )}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {conv.other && (
                  <RenameContactDialog
                    open={renameOpen}
                    onOpenChange={setRenameOpen}
                    contactId={conv.other.id}
                    realName={conv.other.display_name}
                  />
                )}
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
      {/* Pola kanvas dipasang di pembungkus yang TIDAK ikut menggulir: bila
          background bermotif menempel di elemen scroll, ponsel mengecat ulang
          seluruh pola tiap frame dan gulir terasa patah-patah. */}
      {searchOpen && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-card/95 px-3 py-2 backdrop-blur">
          <Input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="Cari pesan di percakapan ini…"
            aria-label="Cari pesan"
            className="h-9 flex-1"
          />
          <span className="min-w-14 text-center text-[11px] font-medium text-muted-foreground">
            {searchTerm.trim().length < 2
              ? "≥2 huruf"
              : matchIndexes.length === 0
                ? "0 hasil"
                : `${matchCursor + 1}/${matchIndexes.length}`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Hasil sebelumnya"
            disabled={matchIndexes.length === 0}
            onClick={() => stepMatch(-1)}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Hasil berikutnya"
            disabled={matchIndexes.length === 0}
            onClick={() => stepMatch(1)}
          >
            <ChevronDown className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Tutup pencarian"
            onClick={() => setSearchOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      <div className="chat-canvas relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onTouchStart={() => {
            lastInteractionRef.current = Date.now();
          }}
          onTouchMove={() => {
            lastInteractionRef.current = Date.now();
          }}
          onTouchEnd={() => {
            lastInteractionRef.current = Date.now();
            // Setelah jari lepas dan momentum reda, rapatkan lagi bila memang
            // sedang berada di pesan terbaru.
            window.setTimeout(() => {
              const el = scrollRef.current;
              if (el && isNearBottom(el)) {
                setMissedCount(0);
                scrollToLatest();
              }
            }, USER_SCROLL_GRACE_MS);
          }}
          onWheel={() => {
            lastInteractionRef.current = Date.now();
          }}
          className="chat-scroll relative flex-1 overflow-y-auto px-2 py-3"
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
                  name={headerName}
                  color={conv.other.avatar_color}
                />
              ) : (
                <MCMAvatar initials={initialsOf(headerName)} color="#0ea5e9" />
              )}
            </span>
            <p className="text-sm font-semibold">Mulai percakapan dengan {headerName}</p>
            <p className="text-xs text-muted-foreground">
              Kirim pesan, foto berlokasi, atau catatan keuangan langsung dari sini.
            </p>
          </div>
        )}
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            const m = row.message;
            const mine = m.sender_id === userId;
            const replyTo = m.reply_to_id ? messageById.get(m.reply_to_id) : undefined;
            const status = deriveStatus(receiptIndex.get(m.id) ?? [], otherMemberCount);
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                data-virtual-row=""
                ref={virtualizer.measureElement}
                className="chat-row absolute top-0 left-0 w-full"
                style={{ transform: `translate3d(0, ${virtualRow.start}px, 0)` }}
              >
                {row.showDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full border border-border/60 bg-card/80 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-xs backdrop-blur">
                      {row.day}
                    </span>
                  </div>
                )}
                {markedIds && m.id === unread.firstId && (
                  <div className="my-2 flex items-center gap-2 px-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-primary/40" />
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                      Belum dibaca
                    </span>
                    <span className="h-px flex-1 bg-primary/40" />
                  </div>
                )}
                <MessageBubble
                  message={m}
                  replyTo={replyTo}
                  replySenderName={replyTo ? nameOf(replyTo.sender_id) : undefined}
                  senderName={nameOf(m.sender_id)}
                  mine={mine}
                  showSender={conv.type !== "direct"}
                  reactions={reactionsByMessage.get(m.id) ?? EMPTY_REACTIONS}
                  status={status}
                  grouped={row.grouped}
                  animateIn={virtualRow.index === rows.length - 1}
                  selectable={selection.length > 0}
                  selected={selection.includes(m.id)}
                  highlighted={
                    search.hl === m.id || markedIds?.has(m.id) === true || activeMatchId === m.id
                  }
                  onAction={handleAction}
                />
              </div>
            );
          })}
        </div>

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
        {unreadMarked && (
          <p role="status" aria-live="polite" className="sr-only">
            {unread.count} pesan belum dibaca disorot, mulai dari pesan pertama.
          </p>
        )}
        </div>
        <TypingIndicator names={typingUsers.map((u) => nameOf(u))} className="pt-1" />
      </div>

      {(!atBottom || scrollLocked || (unread.count > 0 && !unreadDismissed)) && (
        <div className="pointer-events-none sticky bottom-24 z-10 flex items-center justify-end gap-2 px-4">
          {unread.count > 0 && !unreadDismissed && (
            <Button
              size="sm"
              variant="secondary"
              aria-label="Tandai semua pesan sebagai dibaca"
              className="pointer-events-auto h-8 rounded-full px-3 text-xs shadow-md"
              onClick={markAllAsRead}
            >
              <CheckCheck className="mr-1 size-3.5" />
              Tandai semua dibaca
            </Button>
          )}
          {unread.count > 0 && !unreadDismissed && (
            <Button
              size="sm"
              variant="default"
              aria-label={`Ke pesan belum dibaca — ${unread.count} pesan`}
              className="pointer-events-auto h-8 rounded-full px-3 text-xs shadow-md"
              onClick={jumpToFirstUnread}
            >
              <MailOpen className="mr-1 size-3.5" />
              {unread.count > 99 ? "99+" : unread.count} belum dibaca
            </Button>
          )}
          <Button
            size="sm"
            variant={scrollLocked ? "default" : "secondary"}
            aria-pressed={scrollLocked}
            aria-label={
              scrollLocked
                ? "Scroll terkunci — ketuk untuk mengikuti pesan terbaru"
                : "Kunci scroll agar tidak terseret ke pesan terbaru"
            }
            className="pointer-events-auto h-8 rounded-full px-3 text-xs shadow-md"
            onClick={toggleScrollLock}
          >
            {scrollLocked ? (
              <LockIcon className="mr-1 size-3.5" />
            ) : (
              <LockOpenIcon className="mr-1 size-3.5" />
            )}
            {scrollLocked ? "Scroll terkunci" : "Kunci scroll"}
          </Button>
          <Button
            size="icon"
            variant="secondary"
            aria-label={
              missedCount > 0
                ? `Lompat ke ${missedCount} pesan baru`
                : "Lompat ke pesan terbaru"
            }
            className="pointer-events-auto relative rounded-full shadow-md"
            onClick={() => {
              setMissedCount(0);
              setAtBottom(true);
              scrollToLatest("smooth");
            }}
          >
            <ArrowDown className="size-4" />
            {missedCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-primary px-1.5 text-[10px] leading-5 font-semibold text-primary-foreground">
                {missedCount > 99 ? "99+" : missedCount}
              </span>
            )}
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
              <Button
                variant="secondary"
                className="rounded-xl"
                onClick={() => void cancelOutgoing()}
              >
                Batalkan permintaan
              </Button>
            </>
          ) : relation?.request_status === "pending" &&
            relation.request_direction === "incoming" ? (
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
        <ComposerHost
          ref={composerRef}
          onFocusChange={(focused) => {
            composerFocusedRef.current = focused;
          }}
          draftKey={draftKey}
          onTyping={notifyTyping}
          onSend={doSend}
          onAttach={(kind) => {
            if (kind === "document") {
              docRef.current?.click();
              return;
            }
            setPhotoMode(kind === "camera" ? "camera" : "gallery");
            setPhotoOpen(true);
          }}
          onVoice={(blob, sec) => void sendVoice(blob, sec)}
          onNewLedger={() => setLedgerOpen(true)}
          onNewSale={business ? () => setSaleOpen(true) : undefined}
          onNewPreparation={business ? () => setPrepOpen(true) : undefined}
          onLocation={() => setLocationOpen(true)}
          onSticker={() => setStickerOpen(true)}
          editing={!!editingId}
          onCancelEdit={() => {
            setEditingId(null);
            composerRef.current?.clear();
          }}
          replyPreview={reply ?? undefined}
          replySenderName={reply ? nameOf(reply.sender_id) : undefined}
          onCancelReply={() => setReply(null)}
        />
      )}

      <input
        ref={docRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,application/pdf,text/plain,text/csv,application/zip"
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

      <ForwardDialog
        open={forwarding.length > 0}
        onOpenChange={(v) => !v && setForwarding([])}
        messages={forwarding}
        userId={userId}
        onDone={() => {
          setForwarding([]);
          setSelection([]);
          refresh();
        }}
      />

      <Sheet open={photoOpen} onOpenChange={setPhotoOpen}>
        <SheetContent side="bottom" className="h-[92dvh] rounded-t-3xl p-0">
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>{photoMode === "camera" ? "Ambil foto" : "Foto & lokasi"}</SheetTitle>
          </SheetHeader>
          {userId && (
            <PhotoFlow
              userId={userId}
              conversations={conversations ?? []}
              fixedConversationIds={[id]}
              sourceMode={photoMode}
              locationDefault={photoMode === "gallery"}
              onCancel={() => setPhotoOpen(false)}
              onDone={() => {
                setPhotoOpen(false);
                refresh();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={locationOpen} onOpenChange={setLocationOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl p-0">
          <SheetHeader className="px-4 pt-4 pb-3">
            <SheetTitle>Kirim lokasi ke {headerName}</SheetTitle>
          </SheetHeader>
          {userId && (
            <LocationShareFlow
              userId={userId}
              conversationId={id}
              onCancel={() => setLocationOpen(false)}
              onDone={() => {
                setLocationOpen(false);
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
                onClick={() => {
                  if (blocked) {
                    void setBlocked(userId!, conv.other!.id, false).then(() => {
                      void qc.invalidateQueries({ queryKey: ["block", userId, conv.other?.id] });
                      setDetailOpen(false);
                    });
                    return;
                  }
                  setConfirmBlock(true);
                }}
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
            counterpartName: headerName,
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
          customerName={headerName}
          onSuccess={() => refresh()}
        />
      )}

      {business && userId && (
        <CreatePreparationDialog
          open={prepOpen}
          onOpenChange={setPrepOpen}
          businessId={business.business.id}
          conversationId={id}
          customerName={headerName}
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

      <ConfirmDialog
        open={confirmBlock}
        onOpenChange={setConfirmBlock}
        title="Blokir kontak?"
        description="Kontak tidak bisa mengirim pesan, panggilan, atau permintaan baru sampai Anda membuka blokirnya."
        confirmLabel="Blokir"
        destructive
        onConfirm={() => {
          setConfirmBlock(false);
          if (!conv?.other) return;
          void setBlocked(userId!, conv.other.id, true).then(() => {
            void qc.invalidateQueries({ queryKey: ["block", userId, conv.other?.id] });
            setDetailOpen(false);
          });
        }}
      />
    </AppShell>
  );
}
