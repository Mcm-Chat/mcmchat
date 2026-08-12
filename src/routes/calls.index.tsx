import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { durasi, waktuRelatif } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { useCalls } from "@/lib/api/queries";
import type { CallHistoryItem } from "@/lib/api/calls";

export const Route = createFileRoute("/calls/")({
  head: () => ({
    meta: [
      { title: "Panggilan — MCM" },
      { name: "description", content: "Riwayat panggilan suara dan video MCM lengkap dengan durasi dan panggilan tak terjawab." },
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
  const navigate = useNavigate();

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
                  <MCMAvatar initials={(other?.display_name ?? "MC").slice(0, 2).toUpperCase()} color={other?.avatar_color ?? "from-slate-500 to-slate-700"} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-semibold ${isMissed ? "text-destructive" : ""}`}>{other?.display_name ?? "Pengguna MCM"}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {isMissed ? (
                        <PhoneMissed className="size-3.5 text-destructive" />
                      ) : wasIncoming ? (
                        <ArrowDownLeft className="size-3.5 text-success" />
                      ) : (
                        <ArrowUpRight className="size-3.5 text-primary" />
                      )}
                      {c.kind === "video" ? "Video" : "Suara"} •{" "}
                      {isMissed ? "Tak terjawab" : c.status === "ended" ? durasi(c.duration_sec) : STATUS_LABEL[c.status]} •{" "}
                      {waktuRelatif(c.created_at)}
                    </p>
                  </div>
                </button>
                <Button variant="ghost" size="icon" aria-label={`Panggil ${other?.display_name ?? "pengguna"}`} onClick={() => setNotice(true)}>
                  {c.kind === "video" ? <Video className="size-5" /> : <Phone className="size-5" />}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="px-4 py-6">
        <ProtoNote>Panggilan suara/video real-time belum diaktifkan. Riwayat panggilan tetap tercatat.</ProtoNote>
      </div>

      <AlertDialog open={notice} onOpenChange={setNotice}>
        <AlertDialogContent className="max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Panggilan belum dikonfigurasi</AlertDialogTitle>
            <AlertDialogDescription>
              Fitur panggilan suara dan video akan aktif setelah kredensial penyedia panggilan (WebRTC/SFU/TURN) dikonfigurasi
              oleh admin. Belum ada panggilan tiruan yang akan dimulai.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNotice(false)}>Mengerti</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
