import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, MessageSquare, UserPlus } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { LoadingSkeleton, StatusBadge } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { useRequireAuth } from "@/lib/api/guard";
import { qk } from "@/lib/api/queries";
import { getOrCreateDirect } from "@/lib/api/chat";
import { fetchFullProfile, fetchProfileCard } from "@/lib/api/profiles";
import {
  cancelContactRequest,
  getContactRelation,
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
              name={card.display_name}
              color={card.avatar_color}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold">{card.display_name}</h1>
              {full?.pin && (
                <p className="font-mono text-xs text-muted-foreground">{full.pin}</p>
              )}
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

          <div className="grid gap-2">
            {rel?.connected && (
              <Button
                className="h-12 rounded-xl"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const conv = await getOrCreateDirect(userId!, id);
                    await navigate({ to: "/chat/$id", params: { id: conv } });
                  }, "Membuka chat")
                }
              >
                <MessageSquare className="size-4" /> Buka chat
              </Button>
            )}

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
