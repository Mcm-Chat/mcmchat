import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, Eye, MoreVertical, Send, Trash2, VolumeX, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MCMAvatar } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { cn } from "@/lib/utils";
import {
  deleteStatusItem,
  listViewers,
  markStatusViewed,
  reactToStatus,
  replyToStatus,
  setStatusMuted,
} from "@/lib/api/status";
import { statusKeys, useStatusMedia } from "@/lib/status/hooks";
import { advance, initialsOf, REACTIONS, waktuStatus, type StatusGroup, type StatusItem } from "@/lib/status/model";

const TICK = 50;

function SlideMedia({ item }: { item: StatusItem }) {
  const { data: url, isLoading } = useStatusMedia(item.kind === "text" ? null : item.media_path);
  if (item.kind === "text") {
    const meta = item.text_meta ?? {};
    return (
      <div
        className="flex size-full items-center justify-center px-8 text-center"
        style={{ background: meta.background ?? "linear-gradient(160deg,#0f172a,#1e3a8a)" }}
      >
        <p
          className="text-2xl leading-snug font-semibold break-words whitespace-pre-wrap"
          style={{ color: meta.color ?? "#ffffff", fontFamily: meta.font ?? "inherit" }}
        >
          {meta.text}
        </p>
      </div>
    );
  }
  if (isLoading || !url) return <div className="size-full animate-pulse bg-white/5" />;
  return <img src={url} alt={item.caption || "Status"} className="size-full object-contain" draggable={false} />;
}

export function StatusViewer({
  groups,
  startGroup,
  startItem,
  userId,
  shareReceipts,
  onClose,
}: {
  groups: StatusGroup[];
  startGroup: number;
  startItem: number;
  userId: string;
  shareReceipts: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [gi, setGi] = useState(startGroup);
  const [ii, setIi] = useState(startItem);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const [viewersOpen, setViewersOpen] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const group = groups[gi];
  const item = group?.items[ii];
  const mine = group?.mine ?? false;

  const go = useCallback(
    (dir: 1 | -1) => {
      const next = advance(groups, gi, ii, dir);
      if (next.done) return onClose();
      setGi(next.groupIndex);
      setIi(next.itemIndex);
      setElapsed(0);
    },
    [groups, gi, ii, onClose],
  );

  // Timer progres slide; berhenti saat ditahan, saat sheet terbuka, atau saat
  // tab tidak terlihat sehingga status tidak "hangus" di latar belakang.
  useEffect(() => {
    if (!item || paused || viewersOpen) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        if (e + TICK >= item.duration_ms) {
          go(1);
          return 0;
        }
        return e + TICK;
      });
    }, TICK);
    return () => clearInterval(id);
  }, [item, paused, viewersOpen, go]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Catat "dilihat" begitu slide tampil (dilewati bila privasi dimatikan).
  useEffect(() => {
    if (!item || item.owner_id === userId) return;
    void markStatusViewed(item, userId, shareReceipts).then(() =>
      qc.invalidateQueries({ queryKey: ["status", "feed"] }),
    );
  }, [item, userId, shareReceipts, qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const { data: viewers } = useQuery({
    queryKey: statusKeys.viewers(item?.status_id ?? ""),
    queryFn: () => listViewers(item!.status_id),
    enabled: viewersOpen && !!item && mine,
  });

  const progress = useMemo(
    () => (group?.items ?? []).map((it, idx) => (idx < ii ? 1 : idx > ii ? 0 : elapsed / it.duration_ms)),
    [group, ii, elapsed],
  );

  if (!group || !item) return null;

  const name = group.profile?.display_name ?? "Kontak MCM";

  const kirimBalasan = async () => {
    const text = reply.trim();
    if (!text) return;
    setReply("");
    try {
      await replyToStatus(item, userId, text);
      toast.success("Balasan terkirim ke chat");
    } catch {
      toast.error("Balasan gagal terkirim");
    }
  };

  const kirimReaksi = async (emoji: string) => {
    try {
      await reactToStatus(item, userId, emoji);
      toast.success(`Reaksi ${emoji} terkirim`);
    } catch {
      toast.error("Reaksi gagal terkirim");
    }
  };

  const hapusSlide = async () => {
    try {
      await deleteStatusItem(item);
      await qc.invalidateQueries({ queryKey: ["status"] });
      toast.success("Slide status dihapus");
      if (group.items.length <= 1) onClose();
      else setIi((v) => Math.max(0, v - 1));
    } catch {
      toast.error("Slide gagal dihapus");
    }
  };

  const toggleMute = async () => {
    await setStatusMuted(userId, group.ownerId, !group.muted);
    await qc.invalidateQueries({ queryKey: ["status"] });
    toast.success(group.muted ? "Status dibunyikan lagi" : "Status dibisukan");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none"
      onTouchStart={(e) => {
        const t = e.touches[0]!;
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0]!;
        const dy = t.clientY - start.y;
        const dx = Math.abs(t.clientX - start.x);
        if (dy > 90 && dx < 80) onClose();
        else if (dy < -90 && dx < 80 && mine) setViewersOpen(true);
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent pb-10 pt-[env(safe-area-inset-top)]">
        <div className="flex gap-1 px-3 pt-3">
          {progress.map((p, idx) => (
            <div key={idx} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full bg-white transition-[width] duration-75" style={{ width: `${Math.min(1, p) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="pointer-events-auto mt-3 flex items-center gap-3 px-3">
          <MCMAvatar initials={initialsOf(name)} color={group.profile?.avatar_color ?? "#0ea5e9"} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{mine ? "Status Saya" : name}</div>
            <div className="text-[11px] text-white/70">{waktuStatus(item.created_at)}</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9 text-white hover:bg-white/15" aria-label="Menu status">
                <MoreVertical className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mine ? (
                <DropdownMenuItem onSelect={() => void hapusSlide()}>
                  <Trash2 className="size-4" /> Hapus slide ini
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => void toggleMute()}>
                  {group.muted ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  {group.muted ? "Bunyikan status" : "Bisukan status"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="size-9 text-white hover:bg-white/15" aria-label="Tutup" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <SlideMedia item={item} />
        {/* Zona ketuk: kiri mundur, kanan maju, tahan untuk jeda. */}
        {(["prev", "next"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-label={side === "prev" ? "Slide sebelumnya" : "Slide berikutnya"}
            className={cn("absolute inset-y-0 z-10", side === "prev" ? "left-0 w-1/3" : "right-0 w-2/3")}
            onPointerDown={() => {
              holdTimer.current = setTimeout(() => setPaused(true), 220);
            }}
            onPointerUp={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              if (paused) setPaused(false);
              else go(side === "prev" ? -1 : 1);
            }}
            onPointerLeave={() => {
              if (holdTimer.current) clearTimeout(holdTimer.current);
              setPaused(false);
            }}
          />
        ))}
        {item.caption && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-5 pb-6 pt-10 text-center text-sm">
            {item.caption}
          </div>
        )}
      </div>

      <div className="z-20 shrink-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-4">
        {mine ? (
          <Button
            variant="ghost"
            className="mx-auto flex h-11 items-center gap-2 text-white hover:bg-white/15"
            onClick={() => setViewersOpen(true)}
          >
            <Eye className="size-4" /> Lihat penonton
            <ChevronUp className="size-4" />
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-center gap-1.5">
              {REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="rounded-full bg-white/10 px-2.5 py-1.5 text-lg transition-transform active:scale-90"
                  onClick={() => void kirimReaksi(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void kirimBalasan();
              }}
            >
              <Input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                placeholder={`Balas ke ${name}`}
                className="h-11 rounded-full border-white/25 bg-white/10 text-white placeholder:text-white/60"
              />
              <Button type="submit" size="icon" className="size-11 shrink-0 rounded-full" disabled={!reply.trim()}>
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        )}
      </div>

      <Sheet open={viewersOpen} onOpenChange={setViewersOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Dilihat oleh {viewers?.length ?? 0} orang</SheetTitle>
          </SheetHeader>
          <div className="space-y-2 p-4 pt-0">
            {(viewers ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada yang melihat. Kontak yang mematikan tanda dilihat tidak tercatat di sini.
              </p>
            )}
            {(viewers ?? []).map((v) => (
              <div key={`${v.item_id}-${v.viewer_id}`} className="flex items-center gap-3">
                <MCMAvatar initials={initialsOf(v.profile?.display_name ?? "Kontak")} color={v.profile?.avatar_color ?? "#0ea5e9"} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{v.profile?.display_name ?? "Kontak MCM"}</div>
                  <div className="text-xs text-muted-foreground">{waktuStatus(v.viewed_at)}</div>
                </div>
                {v.emoji && <span className="text-lg">{v.emoji}</span>}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
