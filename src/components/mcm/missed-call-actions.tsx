/**
 * Aksi cepat untuk panggilan tak terjawab: balas suara/video, kirim permintaan
 * chat ke kontak, atau simpan pengingat tindak lanjut (tersimpan di database,
 * self-scoped lewat RLS).
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { BellPlus, MessageSquarePlus, Phone, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { sendContactRequest } from "@/lib/api/contacts";
import {
  REMINDER_PRESETS,
  createCallReminder,
  remindAtFrom,
  type ReminderPreset,
} from "@/lib/api/call-reminders";
import { jam, tanggalPanjang } from "@/lib/mcm/format";

export type MissedCallTarget = {
  callId: string;
  conversationId: string | null;
  peerId: string | null;
  peerName: string;
};

/** Id tombol pemicu aksi cepat — dipakai untuk mengembalikan fokus saat sheet ditutup. */
export const missedActionTriggerId = (callId: string) => `missed-action-${callId}`;

export function MissedCallActions({
  userId,
  target,
  onOpenChange,
  onReminderSaved,
  onDelete,
}: {
  userId: string | undefined;
  target: MissedCallTarget | null;
  onOpenChange: (open: boolean) => void;
  onReminderSaved?: (() => void) | undefined;
  onDelete?: ((target: MissedCallTarget) => void) | undefined;
}) {
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const lastCallIdRef = useRef<string | null>(null);
  if (target) lastCallIdRef.current = target.callId;

  const close = () => {
    setNote("");
    onOpenChange(false);
  };

  const callBack = (kind: "audio" | "video") => {
    if (!target?.conversationId) {
      toast.error("Percakapan panggilan ini tidak tersedia lagi.");
      return;
    }
    close();
    void navigate({
      to: "/call/prepare/$conversationId",
      params: { conversationId: target.conversationId },
      search: { kind },
    });
  };

  const requestChat = async () => {
    if (!userId || !target?.peerId) {
      toast.error("Kontak tidak dikenali.");
      return;
    }
    setBusy(true);
    try {
      await sendContactRequest(
        userId,
        target.peerId,
        note.trim() || `Maaf, panggilan Anda tak terjawab. Boleh lanjut lewat chat?`,
      );
      toast.success("Permintaan chat dikirim.");
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Permintaan chat gagal dikirim.");
    } finally {
      setBusy(false);
    }
  };

  const remind = async (preset: ReminderPreset) => {
    if (!userId || !target) return;
    setBusy(true);
    try {
      const at = remindAtFrom(preset);
      await createCallReminder(userId, {
        remindAt: at,
        callId: target.callId,
        conversationId: target.conversationId,
        peerId: target.peerId,
        peerName: target.peerName,
        note: note.trim() || null,
      });
      toast.success(`Pengingat disimpan: ${tanggalPanjang(at.toISOString())} ${jam(at.toISOString())}`);
      onReminderSaved?.();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pengingat gagal disimpan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!target} onOpenChange={(o) => (o ? undefined : close())}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstActionRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          const id = lastCallIdRef.current;
          if (!id) return;
          const trigger = document.getElementById(missedActionTriggerId(id));
          if (!trigger) return;
          e.preventDefault();
          trigger.focus();
        }}
      >
        <SheetHeader className="text-left">
          <SheetTitle>Tindak lanjut {target?.peerName ?? "panggilan"}</SheetTitle>
          <SheetDescription>Balas panggilan, minta chat, atau ingatkan nanti.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-3">
            <Button
              ref={firstActionRef}
              variant="secondary"
              className="min-h-12 rounded-xl"
              disabled={busy}
              onClick={() => callBack("audio")}
            >
              <Phone className="size-4" /> Balas suara
            </Button>
            <Button
              variant="secondary"
              className="min-h-12 rounded-xl"
              disabled={busy}
              onClick={() => callBack("video")}
            >
              <Video className="size-4" /> Balas video
            </Button>
          </div>

          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan (dipakai untuk pesan permintaan chat atau pengingat)"
            className="min-h-20 rounded-xl"
            maxLength={200}
          />

          <Button
            variant="outline"
            className="min-h-12 w-full rounded-xl"
            disabled={busy || !target?.peerId}
            onClick={() => void requestChat()}
          >
            <MessageSquarePlus className="size-4" /> Kirim permintaan chat
          </Button>

          {onDelete && (
            <Button
              variant="outline"
              className="min-h-12 w-full rounded-xl text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => {
                if (!target) return;
                const t = target;
                close();
                onDelete(t);
              }}
            >
              <Trash2 className="size-4" /> Hapus dari riwayat
            </Button>
          )}

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <BellPlus className="size-4" /> Pengingat tindak lanjut
            </p>
            <div className="grid grid-cols-3 gap-2">
              {REMINDER_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  variant="outline"
                  size="sm"
                  className="min-h-11 rounded-xl text-xs whitespace-normal"
                  disabled={busy}
                  onClick={() => void remind(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
