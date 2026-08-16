import { useEffect, useMemo, useState } from "react";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { EmptyState, LoadingSkeleton } from "@/components/mcm/primitives";
import { waktuRelatif } from "@/lib/mcm/format";
import {
  listNotifications,
  markAllRead,
  markRead,
  subscribeNotifications,
  type NotificationRow,
} from "@/lib/api/notifications";
import { getSettings, notificationsOf, type NotificationsPrefs } from "@/lib/api/settings";
import { categoryOfKind } from "@/lib/notifications/categories";

function useNotifications(userId?: string) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    listNotifications(userId)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat notifikasi"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    if (!userId) return;
    return subscribeNotifications(userId, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { items, loading, error, reload: load };
}

export function NotificationBell({ userId }: { userId?: string | undefined }) {
  const { items: all, loading, error, reload } = useNotifications(userId);
  const [prefs, setPrefs] = useState<NotificationsPrefs | null>(null);

  useEffect(() => {
    if (!userId) return;
    void getSettings(userId)
      .then((row) => setPrefs(notificationsOf(row)))
      .catch(() => setPrefs(null));
  }, [userId]);

  // Preferensi per akun juga mengatur daftar di dalam aplikasi, bukan hanya push.
  const items = useMemo(() => {
    if (!prefs) return all;
    return all.filter((n) => {
      const cat = categoryOfKind(n.kind);
      return cat ? prefs[cat] !== false : true;
    });
  }, [all, prefs]);
  const unread = items.filter((n) => !n.is_read).length;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifikasi" className="relative size-9">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-[9px] leading-4 font-bold text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
        <SheetHeader className="flex-row items-center justify-between">
          <SheetTitle>Notifikasi</SheetTitle>
          {unread > 0 && userId && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() =>
                void markAllRead(userId)
                  .then(reload)
                  .catch((err) =>
                    toast.error(err instanceof Error ? err.message : "Gagal menandai semua"),
                  )
              }
            >
              <Check className="size-3.5" /> Tandai semua dibaca
            </Button>
          )}
        </SheetHeader>
        <div className="overflow-y-auto pb-6">
          <NotificationList
            items={items}
            loading={loading}
            error={error}
            onRetry={reload}
            onReload={reload}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function NotificationList({
  items,
  loading,
  error,
  onRetry,
  onReload,
}: {
  items: NotificationRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onReload: () => void;
}) {
  if (loading) return <LoadingSkeleton rows={4} avatar={false} />;
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button size="sm" variant="outline" className="rounded-xl" onClick={onRetry}>
          Coba lagi
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="Belum ada notifikasi"
        description="Notifikasi baru akan muncul di sini."
      />
    );
  }
  return (
    <ul className="divide-y divide-border/70">
      {items.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => {
              if (!n.is_read)
                void markRead(n.id)
                  .then(onReload)
                  .catch(() => toast.error("Gagal menandai notifikasi"));
            }}
            className="flex w-full items-start gap-3 px-1 py-3 text-left"
          >
            <span
              className={`mt-1 size-2 shrink-0 rounded-full ${n.is_read ? "bg-transparent" : "bg-primary"}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{n.title}</span>
              {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
              <span className="block text-[11px] text-muted-foreground">
                {waktuRelatif(n.created_at)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
