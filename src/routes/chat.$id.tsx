import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BellOff,
  Clock,
  Info,
  Phone,
  Search,
  Timer,
  Trash2,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ChatComposer, MessageBubble } from "@/components/mcm/chat-parts";
import { ConfirmDialog, MCMAvatar, ProtoNote, StatusBadge } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chatMessages, uid, useMCM } from "@/lib/mcm/store";
import { labelHari, rupiah } from "@/lib/mcm/format";
import type { Message } from "@/lib/mcm/types";

export const Route = createFileRoute("/chat/$id")({
  head: () => ({
    meta: [
      { title: "Percakapan — MCM" },
      { name: "description", content: "Ruang percakapan MCM dengan balasan, reaksi, lampiran, polling, dan catatan utang bersama." },
      { property: "og:title", content: "Percakapan — MCM" },
      { property: "og:description", content: "Chat privat dengan fitur catatan utang bersama." },
    ],
  }),
  component: ChatRoom,
});

function ChatRoom() {
  const { id } = Route.useParams();
  const { state, update } = useMCM();
  const navigate = useNavigate();
  const chat = state.chats.find((c) => c.id === id);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [info, setInfo] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [dismissSuggestion, setDismissSuggestion] = useState(false);
  const [ledgerForm, setLedgerForm] = useState({ type: "piutang", amount: "", note: "", dueDate: "" });
  const bottom = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => chatMessages(state, id), [state, id]);
  const filtered = search.trim() ? messages.filter((m) => m.text.toLowerCase().includes(search.toLowerCase())) : messages;

  useEffect(() => {
    if (!chat) return;
    if (chat.unread > 0) {
      update((d) => {
        const c = d.chats.find((x) => x.id === id);
        if (c) c.unread = 0;
        return d;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [filtered.length]);

  if (!chat) {
    return (
      <AppShell nav={false} header={<MobileHeader title="Chat tidak ditemukan" back />}>
        <div className="px-6 py-16 text-center text-sm text-muted-foreground">
          Percakapan ini sudah dihapus.
          <div className="mt-4">
            <Button asChild className="rounded-xl">
              <Link to="/chat">Kembali ke daftar chat</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const contact = state.contacts.find((c) => c.id === chat.contactId);

  const push = (partial: Partial<Message> & { kind: Message["kind"]; text: string }) => {
    update((d) => {
      d.messages.push({
        id: uid("m"),
        chatId: id,
        senderId: "me",
        senderName: state.profile.name,
        at: new Date().toISOString(),
        status: "sent",
        reactions: [],
        ...partial,
      } as Message);
      return d;
    });
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    if (value.length > 2000) {
      toast.error("Pesan terlalu panjang (maksimal 2000 karakter)");
      return;
    }
    if (editing) {
      update((d) => {
        const m = d.messages.find((x) => x.id === editing.id);
        if (m) {
          m.text = value;
          m.edited = true;
        }
        return d;
      });
      setEditing(null);
      setText("");
      return;
    }
    push(reply ? { kind: "text", text: value, replyToId: reply.id } : { kind: "text", text: value });
    setText("");
    setReply(null);
    setTimeout(() => {
      update((d) => {
        const c = d.chats.find((x) => x.id === id);
        if (c) c.typing = true;
        return d;
      });
    }, 400);
    setTimeout(() => {
      update((d) => {
        const c = d.chats.find((x) => x.id === id);
        if (c) c.typing = false;
        d.messages.push({
          id: uid("m"),
          chatId: id,
          senderId: chat.contactId ?? "other",
          senderName: contact?.name ?? chat.name,
          kind: "text",
          text: "Baik, saya cek dulu ya 🙏",
          at: new Date().toISOString(),
          status: "read",
          reactions: [],
        });
        return d;
      });
    }, 2200);
  };

  const onAction = (action: string, message: Message, payload?: string) => {
    if (action === "reply") return setReply(message);
    if (action === "edit") {
      setEditing(message);
      setText(message.text);
      return;
    }
    if (action === "copy") {
      void navigator.clipboard.writeText(message.text);
      toast.success("Pesan disalin");
      return;
    }
    if (action === "forward") {
      toast.info("Pilih chat tujuan dari daftar chat untuk meneruskan (simulasi)");
      return;
    }
    update((d) => {
      const m = d.messages.find((x) => x.id === message.id);
      if (!m) return d;
      if (action === "star") m.starred = !m.starred;
      if (action === "pin") m.pinned = !m.pinned;
      if (action === "delete") {
        m.deleted = true;
        m.text = "Pesan ini dihapus";
      }
      if (action === "react" && payload) {
        const existing = m.reactions.find((r) => r.by === "me");
        if (existing && existing.emoji === payload) m.reactions = m.reactions.filter((r) => r.by !== "me");
        else if (existing) existing.emoji = payload;
        else m.reactions.push({ emoji: payload, by: "me" });
      }
      if (action === "vote" && payload && m.pollOptions) {
        m.pollOptions = m.pollOptions.map((o) => (o.label === payload ? { ...o, votes: o.votes + 1 } : o));
      }
      return d;
    });
  };

  const createLedger = () => {
    const amount = Number(ledgerForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Masukkan nominal yang valid");
      return;
    }
    if (ledgerForm.note.trim().length < 3) {
      toast.error("Keterangan minimal 3 karakter");
      return;
    }
    const entryId = uid("lg");
    const due = ledgerForm.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    update((d) => {
      d.ledgers.unshift({
        id: entryId,
        type: ledgerForm.type as "piutang" | "utang",
        counterpartId: chat.contactId ?? chat.id,
        counterpartName: chat.name,
        amount,
        paid: 0,
        date: new Date().toISOString(),
        dueDate: new Date(due).toISOString(),
        note: ledgerForm.note.trim(),
        status: "menunggu",
        reminder: true,
        createdFromChatId: chat.id,
        payments: [],
        timeline: [
          { id: uid("ev"), at: new Date().toISOString(), actor: state.profile.name, label: "Catatan dibuat", detail: "Menunggu persetujuan" },
        ],
      });
      d.messages.push({
        id: uid("m"),
        chatId: id,
        senderId: "me",
        senderName: state.profile.name,
        kind: "ledger",
        text: `${ledgerForm.type === "piutang" ? "Piutang" : "Utang"} ${rupiah(amount)} — ${ledgerForm.note.trim()}`,
        at: new Date().toISOString(),
        status: "sent",
        reactions: [],
        refId: entryId,
      });
      return d;
    });
    setLedgerOpen(false);
    setLedgerForm({ type: "piutang", amount: "", note: "", dueDate: "" });
    toast.success("Catatan utang dikirim untuk persetujuan");
  };

  let lastDay = "";

  const paymentRe = /\b(bayar|dibayar|pembayaran|utang|hutang|piutang|cicil|transfer|invoice|tagihan|pinjam)\w*/i;
  const paymentHint = [...messages].reverse().find((m) => m.senderId !== "me" && paymentRe.test(m.text));
  const showLedgerSuggestion = !!paymentHint && !dismissSuggestion;

  return (
    <AppShell
      nav={false}
      header={
        <MobileHeader
          back
          onBack={() => {
            void navigate({ to: "/chat" });
          }}
          title={
            <span className="flex items-center gap-2">
              {chat.name}
              {chat.isBusiness && <StatusBadge tone="primary">Bisnis</StatusBadge>}
            </span>
          }
          subtitle={chat.typing ? "sedang mengetik…" : chat.type === "group" ? `${chat.memberIds.length} anggota` : contact?.online ? "online" : "terakhir dilihat baru saja"}
          actions={
            <>
              <Button variant="ghost" size="icon" aria-label="Cari pesan" onClick={() => setShowSearch((v) => !v)}>
                <Search className="size-5" />
              </Button>
              {chat.type === "personal" && chat.contactId && (
                <>
                  <Button variant="ghost" size="icon" aria-label="Panggilan suara" asChild>
                    <Link to="/call/$id" params={{ id: chat.contactId }} search={{ kind: "audio" }}>
                      <Phone className="size-5" />
                    </Link>
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Panggilan video" asChild>
                    <Link to="/call/$id" params={{ id: chat.contactId }} search={{ kind: "video" }}>
                      <Video className="size-5" />
                    </Link>
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" aria-label="Info chat" onClick={() => setInfo(true)}>
                <Info className="size-5" />
              </Button>
            </>
          }
        >
          {showSearch && (
            <div className="px-3 pb-3">
              <Input
                autoFocus
                value={search}
                maxLength={60}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari di percakapan ini"
                className="h-10 rounded-xl"
              />
            </div>
          )}
        </MobileHeader>
      }
      className="flex flex-col"
    >
      <div className="flex-1 space-y-1.5 px-3 py-4">
        {chat.disappearingHours > 0 && (
          <div className="mb-2 flex items-center justify-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">
            <Timer className="size-3.5" /> Pesan menghilang setelah {chat.disappearingHours} jam
          </div>
        )}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {search ? "Tidak ada pesan yang cocok." : "Mulai percakapan dengan mengirim pesan pertama."}
          </p>
        )}
        {filtered.map((m) => {
          const day = labelHari(m.at);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{day}</span>
                </div>
              )}
              <MessageBubble
                message={m}
                replyTo={m.replyToId ? messages.find((x) => x.id === m.replyToId) : undefined}
                showSender={chat.type === "group"}
                onAction={onAction}
              />
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {showLedgerSuggestion && (
        <div className="mx-3 mb-2 rounded-2xl border border-primary/30 bg-primary/10 p-3">
          <p className="text-sm font-semibold text-foreground">Terdeteksi pembicaraan pembayaran</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Buat catatan bersama agar nominal dan jatuh temponya tercatat rapi.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" className="flex-1 rounded-lg text-xs" onClick={() => setLedgerOpen(true)}>
              Buat catatan bersama
            </Button>
            <Button size="sm" variant="ghost" className="rounded-lg text-xs" onClick={() => setDismissSuggestion(true)}>
              Nanti
            </Button>
          </div>
        </div>
      )}

      <ChatComposer
        value={text}
        onChange={setText}
        onSend={send}
        onAttach={(kind) => {
          if (kind === "document") push({ kind: "document", text: "Dokumen", attachmentName: "Dokumen-MCM.pdf" });
          else push({ kind: "image", text: kind === "camera" ? "Foto kamera" : "Foto galeri", attachmentName: "foto.jpg" });
          toast.success("Lampiran terkirim (simulasi)");
        }}
        onVoice={() => {
          push({ kind: "voice", text: "Pesan suara", durationSec: 12 });
        }}
        onNewLedger={() => setLedgerOpen(true)}
        editing={!!editing}
        onCancelEdit={() => {
          setEditing(null);
          setText("");
        }}
        replyPreview={reply ?? undefined}
        onCancelReply={() => setReply(null)}
        quickReplies={state.business.quickReplies.map((q) => ({ shortcut: q.shortcut, text: q.text }))}
      />

      <Dialog open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Catatan utang bersama</DialogTitle>
            <DialogDescription>Catatan dikirim ke {chat.name} untuk disetujui.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Jenis</Label>
              <Select value={ledgerForm.type} onValueChange={(v) => setLedgerForm((p) => ({ ...p, type: v }))}>
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="piutang">Mereka berutang ke saya</SelectItem>
                  <SelectItem value="utang">Saya berutang ke mereka</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lg-amount">Nominal (Rp)</Label>
              <Input
                id="lg-amount"
                inputMode="numeric"
                value={ledgerForm.amount}
                maxLength={12}
                onChange={(e) => setLedgerForm((p) => ({ ...p, amount: e.target.value.replace(/\D/g, "") }))}
                placeholder="250000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lg-note">Keterangan</Label>
              <Input id="lg-note" value={ledgerForm.note} maxLength={80} onChange={(e) => setLedgerForm((p) => ({ ...p, note: e.target.value }))} placeholder="Contoh: Pembelian kopi 5kg" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lg-due">Jatuh tempo</Label>
              <Input id="lg-due" type="date" value={ledgerForm.dueDate} onChange={(e) => setLedgerForm((p) => ({ ...p, dueDate: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Batal</Button>
            </DialogClose>
            <Button onClick={createLedger}>
              <Wallet className="size-4" /> Kirim catatan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={info} onOpenChange={setInfo}>
        <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Info {chat.type === "group" ? "grup" : "kontak"}</SheetTitle>
            <SheetDescription>Pengaturan percakapan dan media bersama.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-8">
            <div className="flex flex-col items-center gap-2 py-2">
              <MCMAvatar initials={chat.initials} color={chat.avatarColor} size="xl" />
              <p className="text-lg font-semibold">{chat.name}</p>
              {contact && <p className="font-mono text-xs text-muted-foreground">{contact.pin}</p>}
            </div>

            <div className="card-soft divide-y divide-border">
              <div className="flex items-center justify-between p-3">
                <span className="flex items-center gap-2 text-sm">
                  <BellOff className="size-4" /> Bisukan notifikasi
                </span>
                <Switch
                  checked={chat.muted}
                  onCheckedChange={(v) =>
                    update((d) => {
                      const c = d.chats.find((x) => x.id === id)!;
                      c.muted = v;
                      return d;
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between p-3">
                <span className="flex items-center gap-2 text-sm">
                  <Clock className="size-4" /> Pesan menghilang
                </span>
                <Select
                  value={String(chat.disappearingHours)}
                  onValueChange={(v) =>
                    update((d) => {
                      const c = d.chats.find((x) => x.id === id)!;
                      c.disappearingHours = Number(v);
                      return d;
                    })
                  }
                >
                  <SelectTrigger className="w-32 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Nonaktif</SelectItem>
                    <SelectItem value="24">24 jam</SelectItem>
                    <SelectItem value="168">7 hari</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {chat.type === "group" && (
              <div className="card-soft p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4" /> Anggota ({chat.memberIds.length})
                </p>
                <ul className="space-y-2">
                  {chat.memberIds.map((mid) => {
                    const person = mid === "me" ? state.profile : state.contacts.find((c) => c.id === mid);
                    if (!person) return null;
                    return (
                      <li key={mid} className="flex items-center gap-2">
                        <MCMAvatar initials={person.initials} color={person.avatarColor} size="xs" />
                        <span className="text-sm">{mid === "me" ? "Anda" : person.name}</span>
                        {mid === "me" && <StatusBadge tone="primary">Admin</StatusBadge>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="card-soft p-3">
              <p className="mb-2 text-sm font-semibold">Media & dokumen</p>
              <div className="grid grid-cols-3 gap-2">
                {messages
                  .filter((m) => m.kind === "image" || m.kind === "document")
                  .slice(0, 6)
                  .map((m) => (
                    <div key={m.id} className="flex aspect-square items-center justify-center rounded-xl bg-muted text-center text-[10px] text-muted-foreground">
                      {m.attachmentName}
                    </div>
                  ))}
                {messages.filter((m) => m.kind === "image" || m.kind === "document").length === 0 && (
                  <p className="col-span-3 text-xs text-muted-foreground">Belum ada media dibagikan.</p>
                )}
              </div>
            </div>

            <Button variant="outline" className="w-full rounded-xl text-destructive" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-4" /> Bersihkan percakapan
            </Button>
            <ProtoNote>Enkripsi ujung-ke-ujung nyata membutuhkan backend; versi ini menyimpan data di perangkat Anda.</ProtoNote>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Bersihkan percakapan?"
        description="Semua pesan di chat ini akan dihapus dari perangkat Anda."
        confirmLabel="Bersihkan"
        onConfirm={() => {
          update((d) => {
            d.messages = d.messages.filter((m) => m.chatId !== id);
            return d;
          });
          setInfo(false);
          toast.success("Percakapan dibersihkan");
        }}
      />
    </AppShell>
  );
}
