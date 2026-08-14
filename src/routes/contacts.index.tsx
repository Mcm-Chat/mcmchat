import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, Check, MessageSquare, Search, UserPlus, UserX, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { UserAvatar } from "@/components/mcm/user-avatar";
import {
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  MCMAvatar,
  StatusBadge,
} from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getOrCreateDirect } from "@/lib/api/chat";
import {
  respondToRequest,
  sendContactRequest,
  setBlocked,
  type ContactWithProfile,
  type RequestRow,
} from "@/lib/api/contacts";
import { useRequireAuth } from "@/lib/api/guard";
import { qk, useContacts, useRequests } from "@/lib/api/queries";

export const Route = createFileRoute("/contacts/")({
  head: () => ({
    meta: [
      { title: "Kontak — MCM" },
      {
        name: "description",
        content:
          "Kelola kontak MCM Anda: permintaan masuk, permintaan terkirim, dan daftar blokir.",
      },
      { property: "og:title", content: "Kontak — MCM" },
      { property: "og:description", content: "Kontak berbasis PIN, bukan nomor telepon." },
    ],
  }),
  component: ContactsPage,
});

const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "MC";

function ContactsPage() {
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    data: contacts,
    isLoading: loadingContacts,
    isError: errContacts,
    refetch: refetchContacts,
  } = useContacts(userId);
  const {
    data: requests,
    isLoading: loadingRequests,
    isError: errRequests,
    refetch: refetchRequests,
  } = useRequests(userId);
  const [tab, setTab] = useState("kontak");
  const [q, setQ] = useState("");
  const [toRemove, setToRemove] = useState<ContactWithProfile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: qk.contacts(userId ?? "") });
    void qc.invalidateQueries({ queryKey: qk.requests(userId ?? "") });
  };

  const active = (contacts ?? []).filter((c) => !c.is_blocked && c.connected);
  const savedOnly = (contacts ?? []).filter((c) => !c.is_blocked && !c.connected);
  const blocked = (contacts ?? []).filter((c) => c.is_blocked);
  const incoming = requests?.incoming ?? [];
  const outgoing = requests?.outgoing ?? [];

  const term = q.trim().toLowerCase();
  const matches = (name: string, pin: string) =>
    name.toLowerCase().includes(term) || pin.toLowerCase().includes(term);

  const filteredActive = active.filter((c) => matches(c.profile.display_name, c.profile.pin));
  const filteredSaved = savedOnly.filter((c) => matches(c.profile.display_name, c.profile.pin));
  const filteredIncoming = incoming.filter((r) =>
    matches(r.profile?.display_name ?? "", r.profile?.pin ?? ""),
  );
  const filteredOutgoing = outgoing.filter((r) =>
    matches(r.profile?.display_name ?? "", r.profile?.pin ?? ""),
  );
  const filteredBlocked = blocked.filter((c) => matches(c.profile.display_name, c.profile.pin));

  const isLoading = loading || loadingContacts || loadingRequests;
  const isError = errContacts || errRequests;

  const openChat = async (contactId: string) => {
    if (!userId) return;
    try {
      const id = await getOrCreateDirect(userId, contactId);
      void navigate({ to: "/chat/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuka chat");
    }
  };

  const respond = async (r: RequestRow, action: "accepted" | "rejected" | "blocked") => {
    setBusy(r.id);
    try {
      await respondToRequest(r, action);
      refreshAll();
      toast.success(
        action === "accepted"
          ? "Kontak ditambahkan"
          : action === "rejected"
            ? "Permintaan ditolak"
            : "Pengirim diblokir",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memproses permintaan");
    } finally {
      setBusy(null);
    }
  };

  const askConnect = async (contactId: string) => {
    if (!userId) return;
    setBusy(contactId);
    try {
      await sendContactRequest(userId, contactId, "Halo, saya ingin terhubung di MCM.");
      refreshAll();
      toast.success("Permintaan kontak dikirim");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permintaan gagal dikirim");
    } finally {
      setBusy(null);
    }
  };

  const toggleBlock = async (contactId: string, block: boolean) => {
    if (!userId) return;
    setBusy(contactId);
    try {
      await setBlocked(userId, contactId, block);
      refreshAll();
      toast.success(block ? "Kontak diblokir" : "Blokir dibuka");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui blokir");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell
      header={
        <MobileHeader
          back
          title="Kontak"
          subtitle={`${active.length} terhubung · ${savedOnly.length} disimpan`}
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
              <Input
                value={q}
                maxLength={40}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Cari nama atau PIN"
                placeholder="Cari nama atau PIN"
                className="h-10 rounded-xl pl-9"
              />
            </div>
            <Tabs value={tab} onValueChange={setTab} className="mt-3">
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="kontak" className="flex-1 rounded-lg text-xs">
                  Terhubung
                </TabsTrigger>
                <TabsTrigger value="disimpan" className="flex-1 rounded-lg text-xs">
                  Disimpan{savedOnly.length > 0 ? ` (${savedOnly.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="masuk" className="flex-1 rounded-lg text-xs">
                  Masuk{incoming.length > 0 ? ` (${incoming.length})` : ""}
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
      {isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">Gagal memuat data kontak.</p>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              void refetchContacts();
              void refetchRequests();
            }}
          >
            Coba lagi
          </Button>
        </div>
      ) : tab === "kontak" ? (
        filteredActive.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Belum ada kontak terhubung"
            description="Tambahkan teman dengan memasukkan PIN MCM mereka — tanpa perlu bertukar nomor telepon."
            action={
              <Button className="rounded-xl" asChild>
                <Link to="/contacts/add">Tambah lewat PIN</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border/70 pb-24">
            {filteredActive.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar
                  userId={c.profile.id}
                  path={c.profile.avatar_url}
                  version={c.profile.avatar_version ?? 0}
                  name={c.profile.display_name}
                  color={c.profile.avatar_color}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {c.alias || c.profile.display_name}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{c.profile.pin}</p>
                  {c.profile.bio && (
                    <p className="truncate text-xs text-muted-foreground">{c.profile.bio}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Chat ${c.profile.display_name}`}
                    onClick={() => void openChat(c.contact_id)}
                  >
                    <MessageSquare className="size-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Blokir ${c.profile.display_name}`}
                    disabled={busy === c.contact_id}
                    onClick={() => setToRemove(c)}
                  >
                    <Ban className="size-5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tab === "disimpan" ? (
        filteredSaved.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Tidak ada kartu tersimpan"
            description="Kartu yang Anda simpan dari QR/PIN muncul di sini. Menyimpan bukan berarti terhubung — kirim permintaan agar bisa chat."
          />
        ) : (
          <ul className="divide-y divide-border/70 pb-24">
            {filteredSaved.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <UserAvatar
                  userId={c.profile.id}
                  path={c.profile.avatar_url}
                  version={c.profile.avatar_version ?? 0}
                  name={c.profile.display_name}
                  color={c.profile.avatar_color}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {c.alias || c.profile.display_name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Disimpan satu arah — belum terhubung
                  </p>
                </div>
                <Button
                  size="sm"
                  className="rounded-xl"
                  disabled={busy === c.contact_id}
                  onClick={() => void askConnect(c.contact_id)}
                >
                  Kirim permintaan
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : tab === "masuk" ? (
        filteredIncoming.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Tidak ada permintaan masuk"
            description="Permintaan kontak baru akan muncul di sini."
          />
        ) : (
          <ul className="divide-y divide-border/70 pb-24">
            {filteredIncoming.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                {r.profile ? (
                  <UserAvatar
                    userId={r.requester_id}
                    path={r.profile.avatar_url}
                    version={r.profile.avatar_version}
                    name={r.profile.display_name}
                    color={r.profile.avatar_color}
                  />
                ) : (
                  <MCMAvatar initials="MC" color="from-slate-500 to-slate-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {r.profile?.display_name ?? "Pengguna"}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{r.profile?.pin}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.message}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="icon"
                    className="size-9 rounded-xl"
                    aria-label="Terima"
                    disabled={busy === r.id}
                    onClick={() => void respond(r, "accepted")}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Tolak"
                    disabled={busy === r.id}
                    onClick={() => void respond(r, "rejected")}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : tab === "terkirim" ? (
        filteredOutgoing.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="Tidak ada permintaan terkirim"
            description="Permintaan yang Anda kirim akan tampil di sini sampai direspons."
          />
        ) : (
          <ul className="divide-y divide-border/70 pb-24">
            {filteredOutgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                {r.profile ? (
                  <UserAvatar
                    userId={r.target_id}
                    path={r.profile.avatar_url}
                    version={r.profile.avatar_version}
                    name={r.profile.display_name}
                    color={r.profile.avatar_color}
                  />
                ) : (
                  <MCMAvatar initials="MC" color="from-slate-500 to-slate-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {r.profile?.display_name ?? "Pengguna"}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">{r.profile?.pin}</p>
                </div>
                <StatusBadge tone="warning">Menunggu</StatusBadge>
              </li>
            ))}
          </ul>
        )
      ) : filteredBlocked.length === 0 ? (
        <EmptyState
          icon={Ban}
          title="Tidak ada kontak diblokir"
          description="Kontak yang Anda blokir akan muncul di sini."
        />
      ) : (
        <ul className="divide-y divide-border/70 pb-24">
          {filteredBlocked.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <UserAvatar
                userId={c.profile.id}
                path={c.profile.avatar_url}
                version={c.profile.avatar_version ?? 0}
                name={c.profile.display_name}
                color={c.profile.avatar_color}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.profile.display_name}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{c.profile.pin}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                disabled={busy === c.contact_id}
                onClick={() => void toggleBlock(c.contact_id, false)}
              >
                Buka blokir
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(v) => !v && setToRemove(null)}
        title="Blokir kontak?"
        description="Kontak tidak akan bisa mengirim pesan atau permintaan baru kepada Anda sampai Anda membuka blokirnya."
        confirmLabel="Blokir"
        destructive
        onConfirm={() => {
          if (toRemove) void toggleBlock(toRemove.contact_id, true);
          setToRemove(null);
        }}
      />
    </AppShell>
  );
}
