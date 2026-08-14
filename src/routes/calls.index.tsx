import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDownLeft, ArrowUpRight, Phone, PhoneCall, PhoneMissed, Video } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { EmptyState, LoadingSkeleton, MCMAvatar, ProtoNote } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { durasi, waktuRelatif } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { useCalls } from "@/lib/api/queries";
import { startCall, type CallHistoryItem } from "@/lib/api/calls";
import { getCallConfig } from "@/lib/calls/calls.functions";

export const Route = createFileRoute("/calls/")({
  head: () => ({
    meta: [
      { title: "Panggilan — MCM" },
      {
        name: "description",
        content:
          "Riwayat panggilan suara dan video MCM lengkap dengan durasi dan panggilan tak terjawab.",
      },
      { property: "og:title", content: "Panggilan — MCM" },
      { property: "og:description", content: "Riwayat panggilan suara dan video Anda." },
    ],
  }),
  component: CallsPage,
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

function counterpartOf(call: CallHistoryItem, userId?: string) {
  return call.participants.find((p) => p.user_id !== userId) ?? call.participants[0] ?? null;
}

function CallsPage() {
  const { userId, loading } = useRequireAuth();
  const { data: calls, isLoading, isError, refetch } = useCalls(userId);
  const [tab, setTab] = useState("semua");
  const [notice, setNotice] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const loadConfig = useServerFn(getCallConfig);

  useEffect(() => {
    void loadConfig()
      .then((c) => setConfigured(c.configured))
      .catch(() => setConfigured(false));
  }, [loadConfig]);

  /** Panggil ulang: membuat panggilan nyata baru, bukan mengulang riwayat. */
  const redial = async (c: CallHistoryItem) => {
    if (!userId || !c.conversation_id) return;
    if (configured === false) {
      setNotice(true);
      return;
    }
    try {
      const created = await startCall(c.conversation_id, c.kind);
      void navigate({ to: "/call/$id", params: { id: created.id } });
    } catch {
      setNotice(true);
    }
  };

  const list = (calls ?? [])
    .filter((c) => (tab === "takterjawab" ? c.status === "missed" : true))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const missedCount = (calls ?? []).filter((c) => c.status === "missed").length;
  const busy = loading || isLoading;

  return (
    <AppShell
      header={
        <MobileHeader title="Panggilan" subtitle={`${missedCount} panggilan tak terjawab`}>
          <div className="px-3 pb-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="semua" className="flex-1 rounded-lg">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="takterjawab" className="flex-1 rounded-lg">
                  Tak terjawab
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </MobileHeader>
      }
    >
      {busy ? (
        <LoadingSkeleton rows={6} />
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">Gagal memuat riwayat panggilan.</p>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void refetch()}>
            Coba lagi
          </Button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="Belum ada panggilan"
          description="Riwayat panggilan suara dan video Anda akan muncul di sini."
        />
      ) : (
        <ul className="divide-y divide-border/70">
          {list.map((c) => {
            const other = counterpartOf(c, userId);
            const isMissed = c.status === "missed";
            const wasIncoming = c.initiator_id !== userId;
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => void navigate({ to: "/call/$id", params: { id: c.id } })}
                >
                  {other ? (
                    <UserAvatar
                      userId={other.user_id}
                      path={other.avatar_url}
                      version={other.avatar_version}
                      name={other.display_name}
                      color={other.avatar_color}
                    />
                  ) : (
                    <MCMAvatar initials="MC" color="from-slate-500 to-slate-700" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-sm font-semibold ${isMissed ? "text-destructive" : ""}`}
                    >
                      {other?.display_name ?? "Pengguna MCM"}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {isMissed ? (
                        <PhoneMissed className="size-3.5 text-destructive" />
                      ) : wasIncoming ? (
                        <ArrowDownLeft className="size-3.5 text-success" />
                      ) : (
                        <ArrowUpRight className="size-3.5 text-primary" />
                      )}
                      {c.kind === "video" ? "Video" : "Suara"} •{" "}
                      {isMissed
                        ? "Tak terjawab"
                        : c.status === "ended"
                          ? durasi(c.duration_sec)
                          : STATUS_LABEL[c.status]}{" "}
                      • {waktuRelatif(c.created_at)}
                    </p>
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Panggil ${other?.display_name ?? "pengguna"}`}
                  onClick={() => void redial(c)}
                >
                  {c.kind === "video" ? <Video className="size-5" /> : <Phone className="size-5" />}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {configured === false && (
        <div className="px-4 py-6">
          <ProtoNote>
            Penyedia panggilan (LiveKit) belum terhubung. Panggilan tidak bisa tersambung sampai
            admin mengisi kredensialnya — riwayat panggilan tetap tercatat.
          </ProtoNote>
        </div>
      )}

      <AlertDialog open={notice} onOpenChange={setNotice}>
        <AlertDialogContent className="max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Penyedia panggilan belum terhubung</AlertDialogTitle>
            <AlertDialogDescription>
              Panggilan suara dan video akan aktif setelah admin mengisi kredensial LiveKit (URL,
              API key, API secret). Tidak ada panggilan tiruan yang dibuat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setNotice(false);
                void navigate({ to: "/settings/calls" });
              }}
            >
              Buka diagnostik
            </AlertDialogAction>
            <AlertDialogAction onClick={() => setNotice(false)}>Mengerti</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
