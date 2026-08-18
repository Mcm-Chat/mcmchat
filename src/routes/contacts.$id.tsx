import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, MessageSquare, Phone, Trash2, UserPlus, Unlink, Video } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { RenameContactButton } from "@/components/mcm/rename-contact-dialog";
import { useContactAliases } from "@/lib/contacts/alias";
import { ConfirmDialog, LoadingSkeleton, StatusBadge } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { useRequireAuth } from "@/lib/api/guard";
import { qk } from "@/lib/api/queries";
import { getOrCreateDirect, listConversations, previewOf } from "@/lib/api/chat";
import { waktuStatus } from "@/lib/status/model";
import { fetchFullProfile, fetchProfileCard } from "@/lib/api/profiles";
import {
  cancelContactRequest,
  disconnectContact,
  getContactRelation,
  removeSavedContact,
  saveContact,
  sendContactRequest,
  setBlocked,
} from "@/lib/api/contacts";

export const Route = createFileRoute("/contacts/$id")({
  head: () => ({
    meta: [
      { title: "Detail kontak — MCM" },
      {
        name: "description",
        content: "Lihat kartu profil MCM, status hubungan, dan kirim permintaan kontak.",
      },
      { property: "og:title", content: "Detail kontak — MCM" },
      { property: "og:description", content: "Kartu profil MCM berbasis PIN." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactDetailPage,
});

function ContactDetailPage() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { nameOf } = useContactAliases();

  const profile = useQuery({
    queryKey: ["profile-detail", userId, id],
    enabled: !!userId,
    queryFn: async () => {
      const [card, full] = await Promise.all([
        fetchProfileCard(id),
        fetchFullProfile(id).catch(() => null),
      ]);
      return { card, full };
    },
  });

  const relation = useQuery({
    queryKey: ["contact-relation", userId, id],
    enabled: !!userId,
    queryFn: () => getContactRelation(userId!, id),
  });

  const rel = relation.data;
  const card = profile.data?.card;
  const full = profile.data?.full;

  // Ringkasan percakapan langsung yang sudah ada (tanpa membuat percakapan baru).
  const summary = useQuery({
    queryKey: ["contact-conv-summary", userId, id],
    enabled: !!userId && !!rel?.connected,
    queryFn: async () => {
      const convs = await listConversations(userId!);
      return convs.find((c) => c.type === "direct" && c.other?.id === id) ?? null;
    },
  });
  const conv = summary.data ?? null;

  const openChat = async () => {
    const convId = conv?.id ?? (await getOrCreateDirect(id));
    await navigate({ to: "/chat/$id", params: { id: convId } });
  };

  const startCallWith = async (kind: "audio" | "video") => {
    const convId = conv?.id ?? (await getOrCreateDirect(id));
    await navigate({
      to: "/call/prepare/$conversationId",
      params: { conversationId: convId },
      search: { kind },
    });
  };

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await relation.refetch();
      void qc.invalidateQueries({ queryKey: qk.contacts(userId ?? "") });
      void qc.invalidateQueries({ queryKey: qk.requests(userId ?? "") });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aksi gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell header={<MobileHeader back title="Detail kontak" />}>
      {loading || profile.isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : !card ? (
        <p className="px-6 py-14 text-center text-sm text-muted-foreground">
          Profil tidak tersedia.
        </p>
      ) : (
        <div className="space-y-4 px-4 py-4 pb-28">
          <div className="flex items-center gap-3">
            <UserAvatar
              userId={card.id}
              path={card.avatar_url}
              version={card.avatar_version}
              name={nameOf(card.id, card.display_name)}
              color={card.avatar_color}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-1 text-lg font-semibold">
                <span className="truncate">{nameOf(card.id, card.display_name)}</span>
                <RenameContactButton contactId={card.id} realName={card.display_name} />
              </h1>
              {nameOf(card.id, card.display_name) !== card.display_name && (
                <p className="truncate text-xs text-muted-foreground">
                  Nama asli: {card.display_name}
                </p>
              )}
              {full?.pin && <p className="font-mono text-xs text-muted-foreground">{full.pin}</p>}
              <div className="mt-1">
                {rel?.connected ? (
                  <StatusBadge tone="success">Terhubung</StatusBadge>
                ) : rel?.blockedByMe ? (
                  <StatusBadge tone="danger">Diblokir</StatusBadge>
                ) : rel?.outgoingPending ? (
                  <StatusBadge tone="warning">Menunggu persetujuan</StatusBadge>
                ) : rel?.saved ? (
                  <StatusBadge tone="neutral">Disimpan (satu arah)</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">Belum terhubung</StatusBadge>
                )}
              </div>
            </div>
          </div>

          {full?.bio ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">{full.bio}</p>
          ) : (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Profil lengkap hanya terlihat setelah kalian saling terhubung.
            </p>
          )}

          {rel?.connected && (
            <section className="space-y-3 rounded-2xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Ringkasan percakapan</p>
                  <p className="mt-0.5 truncate text-sm">
                    {summary.isLoading
                      ? "Memuat…"
                      : conv?.lastMessage
                        ? previewOf(conv.lastMessage)
                        : "Belum ada pesan"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {conv?.lastMessage
                      ? waktuStatus(conv.lastMessage.created_at)
                      : "Mulai obrolan pertama kalian"}
                  </p>
                </div>
                {conv && conv.unread > 0 && (
                  <StatusBadge tone="warning">{conv.unread} belum dibaca</StatusBadge>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  className="h-11 rounded-xl"
                  disabled={busy}
                  onClick={() => void run(openChat, "Membuka chat")}
                >
                  <MessageSquare className="size-4" /> Chat
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl"
                  disabled={busy}
                  onClick={() => void run(() => startCallWith("audio"), "Menyiapkan panggilan")}
                >
                  <Phone className="size-4" /> Suara
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-xl"
                  disabled={busy}
                  onClick={() => void run(() => startCallWith("video"), "Menyiapkan panggilan")}
                >
                  <Video className="size-4" /> Video
                </Button>
              </div>
            </section>
          )}

          <div className="grid gap-2">

            {!rel?.connected && !rel?.blockedByMe && !rel?.outgoingPending && (
              <Button
                className="h-12 rounded-xl"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => sendContactRequest(userId!, id, "Halo, saya ingin terhubung di MCM."),
                    "Permintaan kontak dikirim",
                  )
                }
              >
                <UserPlus className="size-4" /> Kirim permintaan
              </Button>
            )}

            {rel?.outgoingPending && (
              <Button
                variant="outline"
                className="h-12 rounded-xl"
                disabled={busy}
                onClick={() =>
                  void run(() => cancelContactRequest(userId!, id), "Permintaan dibatalkan")
                }
              >
                Batalkan permintaan
              </Button>
            )}

            {!rel?.saved && !rel?.blockedByMe && (
              <Button
                variant="outline"
                className="h-12 rounded-xl"
                disabled={busy}
                onClick={() => void run(() => saveContact(userId!, id, "manual"), "Kartu disimpan")}
              >
                Simpan kartu
              </Button>
            )}

            {rel?.saved && !rel?.connected && (
              <Button
                variant="outline"
                className="h-12 rounded-xl"
                disabled={busy}
                onClick={() =>
                  void run(() => removeSavedContact(userId!, id), "Kartu kontak dihapus")
                }
              >
                <Trash2 className="size-4" /> Hapus kartu kontak
              </Button>
            )}

            {rel?.connected && (
              <Button
                variant="outline"
                className="h-12 rounded-xl text-destructive"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Putuskan hubungan dengan kontak ini?")) return;
                  void run(() => disconnectContact(userId!, id), "Hubungan diputus");
                }}
              >
                <Unlink className="size-4" /> Putuskan hubungan
              </Button>
            )}

            <Button
              variant={rel?.blockedByMe ? "outline" : "ghost"}
              className="h-12 rounded-xl text-destructive"
              disabled={busy}
              onClick={() =>
                void run(
                  () => setBlocked(userId!, id, !rel?.blockedByMe),
                  rel?.blockedByMe ? "Blokir dibuka" : "Kontak diblokir",
                )
              }
            >
              <Ban className="size-4" /> {rel?.blockedByMe ? "Buka blokir" : "Blokir kontak"}
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
