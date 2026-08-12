import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Ban, Check, MessageSquare, Search, UserPlus, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { ConfirmDialog, EmptyState, MCMAvatar, StatusBadge } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { uid, useMCM } from "@/lib/mcm/store";

export const Route = createFileRoute("/contacts/")({
  head: () => ({
    meta: [
      { title: "Kontak — MCM" },
      { name: "description", content: "Kelola kontak MCM Anda: permintaan masuk, permintaan terkirim, dan daftar blokir." },
      { property: "og:title", content: "Kontak — MCM" },
      { property: "og:description", content: "Kontak berbasis PIN, bukan nomor telepon." },
    ],
  }),
  component: ContactsPage,
});

function ContactsPage() {
  const { state, update } = useMCM();
  const navigate = useNavigate();
  const [tab, setTab] = useState("kontak");
  const [q, setQ] = useState("");
  const [toRemove, setToRemove] = useState<string | null>(null);

  const list = state.contacts
    .filter((c) => (tab === "kontak" ? c.status === "contact" : tab === "masuk" ? c.status === "incoming" : tab === "terkirim" ? c.status === "outgoing" : c.status === "blocked"))
    .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.pin.toLowerCase().includes(q.toLowerCase()));

  const setStatus = (contactId: string, status: "contact" | "blocked") =>
    update((d) => {
      const c = d.contacts.find((x) => x.id === contactId);
      if (c) c.status = status;
      return d;
    });

  const openChat = (contactId: string) => {
    const existing = state.chats.find((c) => c.contactId === contactId);
    if (existing) {
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
    navigate({ to: "/chat/$id", params: { id } });
  };

  const incoming = state.contacts.filter((c) => c.status === "incoming").length;

  return (
    <AppShell
      header={
        <MobileHeader
          back
          title="Kontak"
          subtitle={`${state.contacts.filter((c) => c.status === "contact").length} kontak tersimpan`}
          actions={
            <Button variant="ghost" size="icon" aria-label="Tambah kontak" asChild>
              <Link to="/contacts/add">
                <UserPlus className="size-5" />
              </Link>
            </Button>
          }
        >
          <div className="px-3 pb-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} maxLength={40} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau PIN" className="h-10 rounded-xl pl-9" />
            </div>
            <Tabs value={tab} onValueChange={setTab} className="mt-3">
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="kontak" className="flex-1 rounded-lg text-xs">
                  Kontak
                </TabsTrigger>
                <TabsTrigger value="masuk" className="flex-1 rounded-lg text-xs">
                  Masuk{incoming > 0 ? ` (${incoming})` : ""}
                </TabsTrigger>
                <TabsTrigger value="terkirim" className="flex-1 rounded-lg text-xs">
                  Terkirim
                </TabsTrigger>
                <TabsTrigger value="blokir" className="flex-1 rounded-lg text-xs">
                  Blokir
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </MobileHeader>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="Belum ada data"
          description="Tambahkan teman dengan memasukkan PIN MCM mereka — tanpa perlu bertukar nomor telepon."
          action={
            <Button className="rounded-xl" asChild>
              <Link to="/contacts/add">Tambah lewat PIN</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border/70 pb-24">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <MCMAvatar initials={c.initials} color={c.avatarColor} online={c.online ?? false} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  {c.name}
                  {c.isBusiness && <StatusBadge tone="primary">Bisnis</StatusBadge>}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">{c.pin}</p>
                <p className="truncate text-xs text-muted-foreground">{c.requestMessage || c.bio}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {c.status === "contact" && (
                  <>
                    <Button variant="ghost" size="icon" aria-label={`Chat ${c.name}`} onClick={() => openChat(c.id)}>
                      <MessageSquare className="size-5" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Hapus ${c.name}`} onClick={() => setToRemove(c.id)}>
                      <UserX className="size-5" />
                    </Button>
                  </>
                )}
                {c.status === "incoming" && (
                  <>
                    <Button size="icon" className="size-9 rounded-xl" aria-label="Terima" onClick={() => { setStatus(c.id, "contact"); toast.success(`${c.name} ditambahkan ke kontak`); }}>
                      <Check className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Tolak" onClick={() => { update((d) => { d.contacts = d.contacts.filter((x) => x.id !== c.id); return d; }); toast.info("Permintaan ditolak"); }}>
                      <X className="size-4" />
                    </Button>
                  </>
                )}
                {c.status === "outgoing" && <StatusBadge tone="warning">Menunggu</StatusBadge>}
                {c.status === "blocked" && (
                  <Button variant="outline" size="sm" className="rounded-xl" onClick={() => { setStatus(c.id, "contact"); toast.success("Blokir dibuka"); }}>
                    Buka blokir
                  </Button>
                )}
                {c.status === "contact" && (
                  <Button variant="ghost" size="icon" aria-label={`Blokir ${c.name}`} onClick={() => { setStatus(c.id, "blocked"); toast.success(`${c.name} diblokir`); }}>
                    <Ban className="size-5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(v) => !v && setToRemove(null)}
        title="Hapus kontak?"
        description="Kontak akan dihapus dari daftar Anda. Riwayat chat tetap tersimpan."
        confirmLabel="Hapus"
        destructive
        onConfirm={() => {
          update((d) => {
            d.contacts = d.contacts.filter((x) => x.id !== toRemove);
            return d;
          });
          setToRemove(null);
          toast.success("Kontak dihapus");
        }}
      />
    </AppShell>
  );
}
