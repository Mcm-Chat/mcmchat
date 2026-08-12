import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bell, Camera, MessageSquarePlus, Search, Users, UserPlus, ShieldCheck, Archive } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ChatListItem } from "@/components/mcm/chat-parts";
import { EmptyState, LoadingSkeleton, MCMAvatar } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { chatSortValue, lastMessage, uid, useMCM } from "@/lib/mcm/store";
import { waktuRelatif } from "@/lib/mcm/format";

export const Route = createFileRoute("/chat/")({
  head: () => ({
    meta: [
      { title: "Chat — MCM" },
      { name: "description", content: "Semua percakapan personal dan grup Anda di MCM, lengkap dengan pencarian, pin, dan arsip." },
      { property: "og:title", content: "Chat — MCM" },
      { property: "og:description", content: "Percakapan personal dan grup yang rapi dan privat." },
    ],
  }),
  component: ChatList,
});

function ChatList() {
  const { state, ready, update } = useMCM();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("semua");
  const [openGroup, setOpenGroup] = useState(false);
  const [openNew, setOpenNew] = useState(false);
  const [openNotif, setOpenNotif] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<string[]>([]);

  const contacts = state.contacts.filter((c) => c.status === "contact");

  const chats = useMemo(() => {
    const filtered = state.chats
      .filter((c) => (tab === "arsip" ? c.archived : !c.archived))
      .filter((c) => (tab === "belum" ? c.unread > 0 : true))
      .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || chatSortValue(state, b) - chatSortValue(state, a));
    return filtered;
  }, [state, tab, q]);

  const createGroup = () => {
    if (groupName.trim().length < 3) {
      toast.error("Nama grup minimal 3 karakter");
      return;
    }
    if (members.length === 0) {
      toast.error("Pilih minimal satu anggota");
      return;
    }
    const id = uid("ch");
    update((d) => {
      d.chats.unshift({
        id,
        type: "group",
        name: groupName.trim(),
        avatarColor: "from-teal-500 to-emerald-700",
        initials: groupName.trim().slice(0, 2).toUpperCase(),
        memberIds: ["me", ...members],
        pinned: false,
        archived: false,
        muted: false,
        unread: 0,
        disappearingHours: 0,
      });
      d.messages.push({
        id: uid("m"),
        chatId: id,
        senderId: "me",
        senderName: state.profile.name,
        kind: "system",
        text: `${state.profile.name} membuat grup "${groupName.trim()}"`,
        at: new Date().toISOString(),
        status: "sent",
        reactions: [],
      });
      return d;
    });
    setOpenGroup(false);
    setGroupName("");
    setMembers([]);
    toast.success("Grup berhasil dibuat");
    navigate({ to: "/chat/$id", params: { id } });
  };

  const startChat = (contactId: string) => {
    const existing = state.chats.find((c) => c.contactId === contactId);
    if (existing) {
      setOpenNew(false);
      navigate({ to: "/chat/$id", params: { id: existing.id } });
      return;
    }
    const contact = state.contacts.find((c) => c.id === contactId)!;
    const id = uid("ch");
    update((d) => {
      d.chats.unshift({
        id,
        type: "personal",
        name: contact.name,
        avatarColor: contact.avatarColor,
        initials: contact.initials,
        contactId,
        memberIds: ["me", contactId],
        pinned: false,
        archived: false,
        muted: false,
        unread: 0,
        disappearingHours: 0,
      });
      return d;
    });
    setOpenNew(false);
    navigate({ to: "/chat/$id", params: { id } });
  };

  const unreadNotif = state.notifications.filter((n) => !n.read).length;

  return (
    <AppShell
      header={
        <MobileHeader
          title="MCM"
          subtitle={`PIN ${state.profile.pin} • Privasi terlindungi`}
          actions={
            <>
              <Button variant="ghost" size="icon" aria-label="Notifikasi" className="relative" onClick={() => setOpenNotif(true)}>
                <Bell className="size-5" />
                {unreadNotif > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive" />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Kontak" asChild>
                <Link to="/contacts">
                  <Users className="size-5" />
                </Link>
              </Button>
            </>
          }
        >
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari chat atau grup"
                className="h-10 rounded-xl pl-9"
                maxLength={60}
              />
            </div>
            <Tabs value={tab} onValueChange={setTab} className="mt-3">
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="semua" className="flex-1 rounded-lg">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="belum" className="flex-1 rounded-lg">
                  Belum dibaca
                </TabsTrigger>
                <TabsTrigger value="arsip" className="flex-1 rounded-lg">
                  Arsip
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </MobileHeader>
      }
    >
      {!ready ? (
        <LoadingSkeleton />
      ) : chats.length === 0 ? (
        <EmptyState
          icon={tab === "arsip" ? Archive : MessageSquarePlus}
          title={q ? "Tidak ada hasil" : tab === "arsip" ? "Belum ada chat diarsipkan" : "Belum ada percakapan"}
          description={
            q
              ? `Tidak ditemukan chat dengan kata "${q}".`
              : "Mulai percakapan dengan kontak Anda atau tambahkan teman lewat PIN MCM."
          }
          action={
            <Button className="rounded-xl" onClick={() => setOpenNew(true)}>
              <MessageSquarePlus className="size-4" /> Chat baru
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border/70 pb-24">
          {chats.map((chat) => {
            const last = lastMessage(state, chat.id);
            return (
              <li key={chat.id}>
                <ChatListItem
                  chat={chat}
                  preview={
                    last
                      ? last.kind === "document"
                        ? `📎 ${last.attachmentName}`
                        : last.kind === "voice"
                          ? "🎤 Pesan suara"
                          : last.kind === "poll"
                            ? `📊 ${last.text}`
                            : last.text
                      : "Belum ada pesan"
                  }
                  time={last ? waktuRelatif(last.at) : ""}
                  outgoing={last?.senderId === "me"}
                  onTogglePin={() =>
                    update((d) => {
                      const c = d.chats.find((x) => x.id === chat.id)!;
                      c.pinned = !c.pinned;
                      toast.success(c.pinned ? "Chat disematkan" : "Sematan dilepas");
                      return d;
                    })
                  }
                  onToggleMute={() =>
                    update((d) => {
                      const c = d.chats.find((x) => x.id === chat.id)!;
                      c.muted = !c.muted;
                      toast.success(c.muted ? "Notifikasi dibisukan" : "Notifikasi dinyalakan");
                      return d;
                    })
                  }
                  onToggleArchive={() =>
                    update((d) => {
                      const c = d.chats.find((x) => x.id === chat.id)!;
                      c.archived = !c.archived;
                      toast.success(c.archived ? "Chat diarsipkan" : "Chat dikeluarkan dari arsip");
                      return d;
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      <div className="pointer-events-none sticky bottom-4 flex justify-end px-4">
        <div className="pointer-events-auto flex flex-col gap-2">
          <Button size="icon" variant="secondary" className="size-11 rounded-2xl shadow-soft" aria-label="Kirim foto" asChild>
            <Link to="/photo/new">
              <Camera className="size-5" />
            </Link>
          </Button>
          <Button size="icon" variant="secondary" className="size-11 rounded-2xl shadow-soft" aria-label="Buat grup" onClick={() => setOpenGroup(true)}>
            <Users className="size-5" />
          </Button>
          <Button size="icon" className="size-14 rounded-2xl shadow-soft" aria-label="Chat baru" onClick={() => setOpenNew(true)}>
            <MessageSquarePlus className="size-6" />
          </Button>
        </div>
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Chat baru</DialogTitle>
            <DialogDescription>Pilih kontak yang sudah menerima permintaan Anda.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {contacts.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted"
                  onClick={() => startChat(c.id)}
                >
                  <MCMAvatar initials={c.initials} color={c.avatarColor} size="sm" online={c.online ?? false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{c.pin}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="rounded-xl" asChild>
            <Link to="/contacts/add">
              <UserPlus className="size-4" /> Tambah kontak lewat PIN
            </Link>
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={openGroup} onOpenChange={setOpenGroup}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Buat grup baru</DialogTitle>
            <DialogDescription>Beri nama grup dan pilih anggotanya.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Nama grup</Label>
            <Input id="group-name" value={groupName} maxLength={40} onChange={(e) => setGroupName(e.target.value)} placeholder="Contoh: Tim Operasional" />
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted">
                <Checkbox
                  id={`m-${c.id}`}
                  checked={members.includes(c.id)}
                  onCheckedChange={(v) => setMembers((prev) => (v ? [...prev, c.id] : prev.filter((x) => x !== c.id)))}
                />
                <Label htmlFor={`m-${c.id}`} className="flex flex-1 items-center gap-2">
                  <MCMAvatar initials={c.initials} color={c.avatarColor} size="xs" />
                  {c.name}
                </Label>
              </li>
            ))}
          </ul>
          <DialogFooter className="flex-row justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Batal</Button>
            </DialogClose>
            <Button onClick={createGroup}>Buat grup</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={openNotif} onOpenChange={setOpenNotif}>
        <SheetContent side="right" className="w-[86vw] max-w-sm">
          <SheetHeader>
            <SheetTitle>Notifikasi</SheetTitle>
            <SheetDescription>Aktivitas terbaru di akun MCM Anda.</SheetDescription>
          </SheetHeader>
          <ul className="space-y-2 overflow-y-auto px-4 pb-4">
            {state.notifications.map((n) => (
              <li key={n.id} className={`rounded-xl border p-3 ${n.read ? "border-border" : "border-primary/40 bg-primary/5"}`}>
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{waktuRelatif(n.at)}</p>
              </li>
            ))}
          </ul>
          <div className="px-4 pb-6">
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => {
                update((d) => {
                  d.notifications = d.notifications.map((n) => ({ ...n, read: true }));
                  return d;
                });
                toast.success("Semua notifikasi ditandai dibaca");
              }}
            >
              Tandai semua dibaca
            </Button>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Notifikasi push nyata membutuhkan integrasi lanjutan.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
