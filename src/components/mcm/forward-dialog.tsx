import { useMemo, useState } from "react";
import { Forward, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useConversations } from "@/lib/api/queries";
import { forwardMessages } from "@/lib/api/forward";
import { useBackDismiss } from "@/lib/mobile/back-guard";
import type { MessageRow } from "@/lib/api/chat";
import { previewOf } from "@/lib/api/chat";

/** Pemilih tujuan untuk meneruskan pesan (bisa banyak percakapan sekaligus). */
export function ForwardDialog({
  open,
  onOpenChange,
  messages,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  messages: MessageRow[];
  userId: string | null | undefined;
  onDone?: (() => void) | undefined;
}) {
  const { data: conversations } = useConversations(userId ?? undefined);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useBackDismiss(open, () => onOpenChange(false));

  const list = useMemo(
    () =>
      (conversations ?? [])
        .filter((c) => c.sendable)
        .filter((c) => c.title_resolved.toLowerCase().includes(q.trim().toLowerCase())),
    [conversations, q],
  );

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const run = async () => {
    if (!userId || picked.length === 0 || busy) return;
    setBusy(true);
    const toastId = toast.loading("Meneruskan pesan…");
    const { ok, failed } = await forwardMessages(messages, picked, userId);
    setBusy(false);
    if (failed === 0) toast.success(`Diteruskan ke ${picked.length} percakapan`, { id: toastId });
    else toast.error(`${ok} terkirim, ${failed} gagal`, { id: toastId });
    setPicked([]);
    onOpenChange(false);
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Teruskan {messages.length > 1 ? `${messages.length} pesan` : "pesan"}</DialogTitle>
        </DialogHeader>
        {messages[0] && (
          <p className="truncate rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {previewOf(messages[0])}
          </p>
        )}
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari percakapan"
            className="pl-9"
          />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Tidak ada percakapan tujuan.
            </p>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-muted"
            >
              <Checkbox checked={picked.includes(c.id)} tabIndex={-1} />
              <span className="truncate text-sm font-medium">{c.title_resolved}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={() => void run()} disabled={picked.length === 0 || busy}>
            <Forward className="size-4" /> Teruskan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
