import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  MessageSquare,
  Phone,
  PhoneMissed,
  Trash2,
  User,
  Video,
  Zap,
} from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { RenameContactButton } from "@/components/mcm/rename-contact-dialog";
import { useContactAliases } from "@/lib/contacts/alias";
import { EmptyState, LoadingSkeleton, MCMAvatar } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { Button } from "@/components/ui/button";
import { durasi, jam, tanggalPanjang } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { useCalls } from "@/lib/api/queries";
import { type CallHistoryItem } from "@/lib/api/calls";
import { getCallConfig } from "@/lib/calls/calls.functions";
import { MissedCallActions, type MissedCallTarget } from "@/components/mcm/missed-call-actions";
import {
  DeleteCallHistoryDialog,
  DeleteCallIconButton,
  type DeleteCallTarget,
} from "@/components/mcm/delete-call-history";
import { isLiveCall, liveStatusLabel, useSecondTick } from "@/lib/calls/live-status";
import { PageSkeleton } from "@/components/mcm/route-skeletons";

export const Route = createFileRoute("/calls/$id")({
  head: () => ({
    meta: [
      { title: "Detail panggilan — MCM" },
      {
        name: "description",
        content:
          "Ringkasan panggilan MCM: arah masuk atau keluar, durasi, peserta, serta panggil ulang.",
      },
      { property: "og:title", content: "Detail panggilan — MCM" },
      { property: "og:description", content: "Ringkasan panggilan, durasi, dan peserta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CallDetailPage,
  pendingComponent: () => <PageSkeleton rows={4} nav={false} />,
});

const STATUS_LABEL: Record<string, string> = {
  ringing: "Berdering",
  ongoing: "Berlangsung",
  ended: "Selesai",
  missed: "Tak terjawab",
  declined: "Ditolak",
  failed: "Gagal",
  unconfigured: "Tidak dikonfigurasi",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

function CallDetailPage() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const { data: calls, isLoading, isError, refetch } = useCalls(userId);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missedTarget, setMissedTarget] = useState<MissedCallTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteCallTarget | null>(null);
  const navigate = useNavigate();
  const loadConfig = useServerFn(getCallConfig);
  const liveStatus = (calls ?? []).find((c) => c.id === id)?.status ?? "";
  useSecondTick(isLiveCall(liveStatus));

  useEffect(() => {
    void loadConfig()
      .then((c) => setConfigured(c.configured))
      .catch(() => setConfigured(false));
  }, [loadConfig]);

  const call: CallHistoryItem | undefined = (calls ?? []).find((c) => c.id === id);
  const other = call?.participants.find((p) => p.user_id !== userId) ?? null;
  const { nameOf } = useContactAliases();
  const peerName = nameOf(other?.user_id, other?.display_name ?? "Pengguna MCM");
  const incoming = !!call && call.initiator_id !== userId;

  const redial = async (kind: "audio" | "video") => {
    if (!call?.conversation_id) return;
    if (configured === false) {
      setError(
        "Penyedia panggilan belum terhubung. Panggilan baru tidak bisa dibuat sampai kredensial diisi.",
      );
      return;
    }
    try {
      void navigate({
        to: "/call/prepare/$conversationId",
        params: { conversationId: call.conversation_id },
        search: { kind },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai panggilan.");
    }
  };

  const busy = loading || isLoading;

  const askDelete = () => {
    if (!call) return;
    setDeleteTarget({
      ids: [call.id],
      title: `Hapus panggilan dengan ${peerName}?`,
    });
  };

  return (
    <AppShell
      header={
        <MobileHeader
          title="Detail panggilan"
          back
          actions={
            call ? (
              <DeleteCallIconButton label="Hapus riwayat panggilan ini" onClick={askDelete} />
            ) : undefined
          }
        />
      }
    >
      {busy ? (
        <LoadingSkeleton rows={5} />
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">Gagal memuat detail panggilan.</p>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void refetch()}>
            Coba lagi
          </Button>
        </div>
      ) : !call ? (
        <EmptyState
          icon={PhoneMissed}
          title="Panggilan tidak ditemukan"
          description="Riwayat panggilan ini sudah tidak tersedia untuk akun Anda."
        />
      ) : (
        <div className="space-y-4 px-4 py-4">
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-border/70 bg-card p-5 text-center">
            {other ? (
              <UserAvatar
                userId={other.user_id}
                path={other.avatar_url}
                version={other.avatar_version}
                name={peerName}
                color={other.avatar_color}
                size="lg"
              />
            ) : (
              <MCMAvatar initials="MC" color="from-slate-500 to-slate-700" size="lg" />
            )}
            <div>
              <h1 className="flex items-center justify-center gap-1 text-lg font-semibold">
                <span className="truncate">{peerName}</span>
                {other && (
                  <RenameContactButton contactId={other.user_id} realName={other.display_name} />
                )}
              </h1>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                {call.status === "missed" ? (
                  <PhoneMissed className="size-4 text-destructive" />
                ) : incoming ? (
                  <ArrowDownLeft className="size-4 text-success" />
                ) : (
                  <ArrowUpRight className="size-4 text-primary" />
                )}
                {incoming ? "Panggilan masuk" : "Panggilan keluar"} •{" "}
                {call.kind === "video" ? "Video" : "Suara"}
              </p>
            </div>
            <div className="flex w-full gap-2 pt-1">
              <Button className="h-11 flex-1 rounded-xl" onClick={() => void redial("audio")}>
                <Phone className="size-4" /> Panggil ulang
              </Button>
              <Button
                variant="outline"
                className="h-11 flex-1 rounded-xl"
                onClick={() => void redial("video")}
              >
                <Video className="size-4" /> Video
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {call.status === "missed" && (
              <Button
                variant="secondary"
                className="h-11 w-full rounded-xl"
                onClick={() =>
                  setMissedTarget({
                    callId: call.id,
                    conversationId: call.conversation_id,
                    peerId: other?.user_id ?? null,
                    peerName,
                  })
                }
              >
                <Zap className="size-4" /> Aksi cepat tak terjawab
              </Button>
            )}
          </section>

          <section className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
            <Row label="Arah" value={incoming ? "Masuk" : "Keluar"} />
            <Row
              label="Status"
              value={
                isLiveCall(call.status)
                  ? liveStatusLabel(call)
                  : OUTCOME_LABEL[callOutcome(call, userId)]
              }
            />
            <Row
              label="Durasi"
              value={
                callOutcome(call, userId) === "answered"
                  ? durasi(call.duration_sec)
                  : isLiveCall(call.status)
                    ? (liveStatusLabel(call).split(" • ")[1] ?? "—")
                    : "—"
              }
            />
            <Row label="Tanggal" value={tanggalPanjang(call.created_at)} />
            <Row label="Jam mulai" value={jam(call.created_at)} />
            <Row label="Jumlah peserta" value={`${call.participants.length} orang`} />
          </section>

          <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <h2 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Peserta
            </h2>
            <ul className="divide-y divide-border/70">
              {call.participants.map((p) => (
                <li key={p.user_id} className="flex items-center gap-3 px-4 py-3">
                  <UserAvatar
                    userId={p.user_id}
                    path={p.avatar_url}
                    version={p.avatar_version}
                    name={p.display_name}
                    color={p.avatar_color}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.display_name}
                    {p.user_id === userId ? " (Anda)" : ""}
                  </span>
                  {p.user_id === call.initiator_id && (
                    <span className="text-xs text-muted-foreground">Pemanggil</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            {call.conversation_id && (
              <Button variant="outline" className="h-11 w-full justify-start rounded-xl" asChild>
                <Link to="/chat/$id" params={{ id: call.conversation_id }}>
                  <MessageSquare className="size-4" /> Buka percakapan
                </Link>
              </Button>
            )}
            {other && (
              <Button variant="outline" className="h-11 w-full justify-start rounded-xl" asChild>
                <Link to="/contacts/$id" params={{ id: other.user_id }}>
                  <User className="size-4" /> Hubungi kontak
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              className="h-11 w-full justify-start rounded-xl text-destructive hover:text-destructive"
              onClick={askDelete}
            >
              <Trash2 className="size-4" /> Hapus riwayat panggilan ini
            </Button>
          </section>
        </div>
      )}
      <MissedCallActions
        userId={userId}
        target={missedTarget}
        onOpenChange={(o) => (o ? undefined : setMissedTarget(null))}
        onDelete={(t) => {
          setMissedTarget(null);
          setDeleteTarget({ ids: [t.callId], title: `Hapus panggilan dengan ${t.peerName}?` });
        }}
      />

      <DeleteCallHistoryDialog
        userId={userId}
        target={deleteTarget}
        onOpenChange={(o) => (o ? undefined : setDeleteTarget(null))}
        onDeleted={() => {
          void refetch();
          void navigate({ to: "/calls" });
        }}
      />
    </AppShell>
  );
}
