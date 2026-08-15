import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { registerDismissible } from "@/lib/a11y/escape-dismiss";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  Check,
  MoreHorizontal,
  Phone,
  PhoneCall,
  PhoneMissed,
  Search,
  Settings2,
  Video,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { durasi, waktuRelatif } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { useCalls, useConversations } from "@/lib/api/queries";
import { type CallHistoryItem } from "@/lib/api/calls";
import { isLiveCall, liveStatusLabel, useSecondTick } from "@/lib/calls/live-status";
import { getCallConfig } from "@/lib/calls/calls.functions";
import {
  MissedCallActions,
  type MissedCallTarget,
} from "@/components/mcm/missed-call-actions";
import {
  completeCallReminder,
  dueReminders,
  listCallReminders,
  type CallReminder,
} from "@/lib/api/call-reminders";

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
  const { data: conversations } = useConversations(userId);
  const [tab, setTab] = useState("semua");
  const [notice, setNotice] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [missedTarget, setMissedTarget] = useState<MissedCallTarget | null>(null);
  const [reminders, setReminders] = useState<CallReminder[]>([]);
  const [dismissedReminders, setDismissedReminders] = useState<string[]>([]);
  const navigate = useNavigate();
  const loadConfig = useServerFn(getCallConfig);

  useEffect(() => {
    void loadConfig()
      .then((c) => setConfigured(c.configured))
      .catch(() => setConfigured(false));
  }, [loadConfig]);

  const reloadReminders = () => {
    if (!userId) return;
    void listCallReminders(userId)
      .then(setReminders)
      .catch(() => undefined);
  };

  useEffect(() => {
    reloadReminders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /** Panggil ulang: membuat panggilan nyata baru, bukan mengulang riwayat. */
  const redial = async (c: CallHistoryItem) => {
    if (!userId || !c.conversation_id) return;
    if (configured === false) {
      setNotice(true);
      return;
    }
    try {
      void navigate({
        to: "/call/prepare/$conversationId",
        params: { conversationId: c.conversation_id },
        search: { kind: c.kind === "video" ? "video" : "audio" },
      });
    } catch {
      setNotice(true);
    }
  };

  /** Mulai panggilan baru dari daftar percakapan langsung. */
  const callConversation = async (conversationId: string, kind: "audio" | "video") => {
    if (configured === false) {
      setNewOpen(false);
      setNotice(true);
      return;
    }
    try {
      setNewOpen(false);
      void navigate({
        to: "/call/prepare/$conversationId",
        params: { conversationId },
        search: { kind },
      });
    } catch {
      setNewOpen(false);
      setNotice(true);
    }
  };

  const list = (calls ?? [])
    .filter((c) => {
      if (tab === "takterjawab") return c.status === "missed";
      if (tab === "masuk") return c.initiator_id !== userId;
      if (tab === "keluar") return c.initiator_id === userId;
      return true;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const dialTargets = (conversations ?? []).filter(
    (c) => !c.me.is_archived && c.title_resolved.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const missedCount = (calls ?? []).filter((c) => c.status === "missed").length;
  const hasLive = (calls ?? []).some((c) => isLiveCall(c.status));
  useSecondTick(hasLive);
  const busy = loading || isLoading;
  const due = dueReminders(reminders);
  const visibleDue = due.filter((r) => !dismissedReminders.includes(r.id));

  const dismissReminder = (id: string) => {
    setDismissedReminders((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const lastDueId = visibleDue.length > 0 ? visibleDue[visibleDue.length - 1]!.id : null;
  useEffect(() => {
    if (!lastDueId) return;
    return registerDismissible(() => dismissReminder(lastDueId));
  }, [lastDueId]);

  const finishReminder = async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    await completeCallReminder(id).catch(() => reloadReminders());
  };

  return (
    <AppShell
      header={
        <MobileHeader
          title="Panggilan"
          subtitle={`${missedCount} panggilan tak terjawab`}
          actions={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Pengaturan panggilan"
              className="size-11"
              onClick={() => void navigate({ to: "/settings/calls" })}
            >
              <Settings2 className="size-5" />
            </Button>
          }
        >
          <div className="px-3 pb-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full rounded-xl">
                <TabsTrigger value="semua" className="flex-1 rounded-lg">
                  Semua
                </TabsTrigger>
                <TabsTrigger value="masuk" className="flex-1 rounded-lg">
                  Masuk
                </TabsTrigger>
                <TabsTrigger value="keluar" className="flex-1 rounded-lg">
                  Keluar
                </TabsTrigger>
                <TabsTrigger value="takterjawab" className="flex-1 rounded-lg">
                  Tak dijawab
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </MobileHeader>
      }
    >
      <div aria-live="polite" aria-atomic="false" aria-label="Pengingat panggilan" role="status">
      {visibleDue.length > 0 && (
        <ul className="space-y-2 px-4 pt-3">
          {visibleDue.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3"
            >
              <BellRing className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  Tindak lanjuti {r.peer_name ?? "panggilan tak terjawab"}
                </p>
                {r.note && <p className="truncate text-xs text-muted-foreground">{r.note}</p>}
              </div>
              {r.conversation_id && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Panggil sekarang"
                  onClick={() =>
                    void navigate({
                      to: "/call/prepare/$conversationId",
                      params: { conversationId: r.conversation_id! },
                      search: { kind: "audio" },
                    })
                  }
                >
                  <Phone className="size-5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Tandai selesai"
                onClick={() => void finishReminder(r.id)}
              >
                <Check className="size-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Tutup pengingat"
                title="Tutup pengingat (Esc)"
                onClick={() => dismissReminder(r.id)}
              >
                <X className="size-5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      </div>
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
                  onClick={() => void navigate({ to: "/calls/$id", params: { id: c.id } })}
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
                    {isLiveCall(c.status) && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        <span className="size-1.5 animate-pulse rounded-full bg-success" />
                        {c.status === "ringing" ? "Sedang dipanggil" : "Berlangsung"}
                      </span>
                    )}
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
                        : isLiveCall(c.status)
                          ? liveStatusLabel(c)
                          : c.status === "ended"
                            ? durasi(c.duration_sec)
                            : STATUS_LABEL[c.status]}{" "}
                      • {waktuRelatif(c.created_at)}
                    </p>
                  </div>
                </button>
                {isMissed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Aksi cepat panggilan tak terjawab dari ${other?.display_name ?? "pengguna"}`}
                    onClick={() =>
                      setMissedTarget({
                        callId: c.id,
                        conversationId: c.conversation_id,
                        peerId: other?.user_id ?? null,
                        peerName: other?.display_name ?? "Pengguna MCM",
                      })
                    }
                  >
                    <MoreHorizontal className="size-5" />
                  </Button>
                )}
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

      <MissedCallActions
        userId={userId}
        target={missedTarget}
        onOpenChange={(o) => (o ? undefined : setMissedTarget(null))}
        onReminderSaved={reloadReminders}
      />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogTrigger asChild>
          <Button
            size="icon"
            aria-label="Panggilan baru"
            className="fixed right-4 bottom-20 z-40 size-13 rounded-full shadow-lg sm:right-[max(1rem,calc(50%-13rem))]"
          >
            <PhoneCall className="size-5.5" />
          </Button>
        </DialogTrigger>
        <DialogContent
          className="rounded-2xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Panggilan baru</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={q}
              maxLength={60}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari kontak atau grup"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <ul className="max-h-72 divide-y divide-border/70 overflow-y-auto">
            {dialTargets.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                {c.other ? (
                  <UserAvatar
                    userId={c.other.id}
                    path={c.other.avatar_url}
                    version={c.other.avatar_version}
                    name={c.title_resolved}
                    color={c.other.avatar_color}
                    size="sm"
                  />
                ) : (
                  <MCMAvatar initials="MC" color="from-slate-500 to-slate-700" size="sm" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {c.title_resolved}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Panggilan suara ke ${c.title_resolved}`}
                  onClick={() => void callConversation(c.id, "audio")}
                >
                  <Phone className="size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Panggilan video ke ${c.title_resolved}`}
                  onClick={() => void callConversation(c.id, "video")}
                >
                  <Video className="size-5" />
                </Button>
              </li>
            ))}
            {dialTargets.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">
                Tidak ada percakapan untuk dipanggil.
              </li>
            )}
          </ul>
        </DialogContent>
      </Dialog>

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
            <AlertDialogCancel onClick={() => setNotice(false)}>Mengerti</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setNotice(false);
                void navigate({ to: "/settings/calls" });
              }}
            >
              Buka diagnostik
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
