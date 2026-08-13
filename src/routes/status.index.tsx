import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleDashed, Plus, Settings2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { EmptyState, LoadingSkeleton, MCMAvatar } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { StatusViewer } from "@/components/mcm/status-viewer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/lib/api/guard";
import { saveStatusPreferences } from "@/lib/api/status";
import {
  statusKeys,
  useStatusFeed,
  useStatusMedia,
  useStatusPrefs,
  useStatusRealtime,
} from "@/lib/status/hooks";
import {
  firstUnseenIndex,
  groupFeed,
  initialsOf,
  LIFETIME_OPTIONS,
  sisaWaktu,
  waktuStatus,
  type StatusGroup,
} from "@/lib/status/model";

export const Route = createFileRoute("/status/")({
  head: () => ({
    meta: [
      { title: "Status — MCM" },
      {
        name: "description",
        content:
          "Bagikan kabar 24 jam ke kontak MCM Anda: foto, teks, reaksi, dan daftar penonton.",
      },
      { property: "og:title", content: "Status — MCM" },
      {
        property: "og:description",
        content: "Status singkat untuk kontak MCM: foto, teks, reaksi, dan privasi penuh.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StatusIndex,
});

function Ring({ group, onClick }: { group: StatusGroup; onClick: () => void }) {
  const first = group.items[0];
  const { data: thumb } = useStatusMedia(first?.thumb_path ?? first?.media_path ?? null);
  const name = group.mine ? "Status Saya" : (group.profile?.display_name ?? "Kontak");
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-16 shrink-0 flex-col items-center gap-1.5"
    >
      <span
        className={cn(
          "grid size-16 place-items-center rounded-full p-[2.5px]",
          group.unseen > 0 ? "bg-gradient-to-tr from-primary to-accent" : "bg-border",
        )}
      >
        <span className="grid size-full place-items-center overflow-hidden rounded-full bg-card p-[2px]">
          {thumb ? (
            <img src={thumb} alt="" className="size-full rounded-full object-cover" />
          ) : (
            <UserAvatar
              userId={group.ownerId}
              path={group.profile?.avatar_url}
              version={group.profile?.avatar_version}
              name={name}
              color={group.profile?.avatar_color ?? "#0ea5e9"}
              size="md"
            />
          )}
        </span>
      </span>
      <span className="w-full truncate text-center text-[11px] text-muted-foreground">{name}</span>
    </button>
  );
}

function GroupRow({ group, onClick }: { group: StatusGroup; onClick: () => void }) {
  const first = group.items[0];
  const { data: thumb } = useStatusMedia(first?.thumb_path ?? first?.media_path ?? null);
  const name = group.mine ? "Status Saya" : (group.profile?.display_name ?? "Kontak MCM");
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          "grid size-13 shrink-0 place-items-center rounded-full p-[2.5px]",
          group.unseen > 0 ? "bg-gradient-to-tr from-primary to-accent" : "bg-border",
        )}
      >
        <span className="grid size-full place-items-center overflow-hidden rounded-full bg-card p-[2px]">
          {thumb ? (
            <img src={thumb} alt="" className="size-full rounded-full object-cover" />
          ) : (
            <UserAvatar
              userId={group.ownerId}
              path={group.profile?.avatar_url}
              version={group.profile?.avatar_version}
              name={name}
              color={group.profile?.avatar_color ?? "#0ea5e9"}
              size="md"
            />
          )}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
          {name}
          {group.muted && <VolumeX className="size-3.5 text-muted-foreground" />}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {group.items.length} slide • {waktuStatus(group.lastAt)} • {sisaWaktu(group.expiresAt)}
        </span>
      </span>
      {group.unseen > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
          {group.unseen}
        </span>
      )}
    </button>
  );
}

function StatusIndex() {
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: feed, isLoading } = useStatusFeed(userId ?? undefined);
  const { data: prefs } = useStatusPrefs(userId ?? undefined);
  useStatusRealtime(userId ?? undefined);
  const [viewer, setViewer] = useState<{ group: number; item: number } | null>(null);

  const groups = useMemo(
    () =>
      feed && userId ? groupFeed(feed.rows, feed.items, feed.profiles, userId, feed.seen) : [],
    [feed, userId],
  );
  const mine = groups.find((g) => g.mine) ?? null;
  const others = groups.filter((g) => !g.mine);
  const baru = others.filter((g) => !g.muted && g.unseen > 0);
  const dilihat = others.filter((g) => !g.muted && g.unseen === 0);
  const dibisukan = others.filter((g) => g.muted);

  const open = (group: StatusGroup) => {
    const idx = groups.indexOf(group);
    setViewer({
      group: idx,
      item: group.mine ? 0 : firstUnseenIndex(group.items, feed?.seen ?? new Set()),
    });
  };

  const simpanPrefs = async (patch: Parameters<typeof saveStatusPreferences>[1]) => {
    if (!userId) return;
    await saveStatusPreferences(userId, patch);
    await qc.invalidateQueries({ queryKey: statusKeys.prefs(userId) });
    toast.success("Pengaturan status disimpan");
  };

  if (loading || !userId) return <LoadingSkeleton />;

  return (
    <AppShell
      nav
      header={
        <MobileHeader
          title="Status"
          subtitle="Kabar singkat untuk kontak Anda"
          actions={
            <>
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    aria-label="Pengaturan status"
                  >
                    <Settings2 className="size-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-2xl">
                  <SheetHeader>
                    <SheetTitle>Pengaturan status</SheetTitle>
                  </SheetHeader>
                  <div className="space-y-5 p-4 pt-0">
                    <div className="space-y-2">
                      <Label>Privasi bawaan</Label>
                      <Select
                        value={prefs?.default_privacy ?? "contacts"}
                        onValueChange={(v) =>
                          void simpanPrefs({ default_privacy: v as "contacts" })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contacts">Semua kontak saya</SelectItem>
                          <SelectItem value="contacts_except">Kontak saya, kecuali…</SelectItem>
                          <SelectItem value="only_share_with">Hanya bagikan dengan…</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Masa aktif bawaan</Label>
                      <Select
                        value={String(prefs?.default_lifetime_minutes ?? 1440)}
                        onValueChange={(v) =>
                          void simpanPrefs({ default_lifetime_minutes: Number(v) })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LIFETIME_OPTIONS.map((o) => (
                            <SelectItem key={o.minutes} value={String(o.minutes)}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label htmlFor="share-views">Tanda dilihat</Label>
                        <p className="text-xs text-muted-foreground">
                          Bila dimatikan, nama Anda tidak muncul di daftar penonton status orang
                          lain.
                        </p>
                      </div>
                      <Switch
                        id="share-views"
                        checked={prefs?.share_view_receipts ?? true}
                        onCheckedChange={(v) => void simpanPrefs({ share_view_receipts: v })}
                      />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              <Button
                size="icon"
                className="size-9 rounded-full"
                aria-label="Buat status"
                onClick={() => navigate({ to: "/status/new" })}
              >
                <Plus className="size-5" />
              </Button>
            </>
          }
        />
      }
    >
      <div className="space-y-5 p-3 pb-8">
        <div className="flex gap-3 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => navigate({ to: "/status/new" })}
            className="flex w-16 shrink-0 flex-col items-center gap-1.5"
          >
            <span className="grid size-16 place-items-center rounded-full border-2 border-dashed border-primary/60 text-primary">
              <Plus className="size-6" />
            </span>
            <span className="text-[11px] text-muted-foreground">Buat</span>
          </button>
          {mine && <Ring group={mine} onClick={() => open(mine)} />}
          {baru.map((g) => (
            <Ring key={g.ownerId} group={g} onClick={() => open(g)} />
          ))}
        </div>

        {isLoading && <LoadingSkeleton rows={4} />}

        {!isLoading && groups.length === 0 && (
          <EmptyState
            icon={CircleDashed}
            title="Belum ada status"
            description="Bagikan foto atau teks singkat — otomatis hilang setelah masa aktif berakhir."
            action={
              <Button onClick={() => navigate({ to: "/status/new" })}>Buat status pertama</Button>
            }
          />
        )}

        {mine && (
          <section className="space-y-1">
            <h2 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Status saya
            </h2>
            <GroupRow group={mine} onClick={() => open(mine)} />
          </section>
        )}
        {baru.length > 0 && (
          <section className="space-y-1">
            <h2 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Pembaruan terbaru
            </h2>
            {baru.map((g) => (
              <GroupRow key={g.ownerId} group={g} onClick={() => open(g)} />
            ))}
          </section>
        )}
        {dilihat.length > 0 && (
          <section className="space-y-1">
            <h2 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Sudah dilihat
            </h2>
            {dilihat.map((g) => (
              <GroupRow key={g.ownerId} group={g} onClick={() => open(g)} />
            ))}
          </section>
        )}
        {dibisukan.length > 0 && (
          <section className="space-y-1">
            <h2 className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Dibisukan
            </h2>
            {dibisukan.map((g) => (
              <GroupRow key={g.ownerId} group={g} onClick={() => open(g)} />
            ))}
          </section>
        )}
      </div>

      {viewer && (
        <StatusViewer
          groups={groups}
          startGroup={viewer.group}
          startItem={viewer.item}
          userId={userId}
          shareReceipts={prefs?.share_view_receipts ?? true}
          onClose={() => setViewer(null)}
        />
      )}
    </AppShell>
  );
}
