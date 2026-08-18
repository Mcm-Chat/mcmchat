/**
 * Dialog catatan singkat per panggilan — dipakai di daftar panggilan dan
 * halaman detail. Catatan bersifat pribadi (hanya milik pengguna sendiri).
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NotebookPen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/mcm/primitives";
import { CALL_NOTE_MAX, deleteCallNote, saveCallNote } from "@/lib/api/call-notes";

export type CallNoteTarget = {
  callId: string;
  peerName: string;
  note: string;
};

/** Id tombol pemicu catatan — dipakai untuk mengembalikan fokus setelah dialog tutup. */
export const callNoteTriggerId = (callId: string) => `call-note-${callId}`;

export function CallNoteIconButton({
  callId,
  hasNote,
  label,
  onClick,
}: {
  callId: string;
  hasNote: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      id={callNoteTriggerId(callId)}
      aria-label={label}
      title={hasNote ? "Lihat/ubah catatan" : "Tambah catatan"}
      onClick={onClick}
    >
      <NotebookPen className={`size-5 ${hasNote ? "text-primary" : ""}`} />
    </Button>
  );
}

export function CallNoteDialog({
  userId,
  target,
  onOpenChange,
  onSaved,
}: {
  userId: string | undefined;
  target: CallNoteTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (() => void) | undefined;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (target) setText(target.note);
  }, [target]);

  const close = () => onOpenChange(false);

  const save = async () => {
    if (!userId || !target) return;
    setBusy(true);
    try {
      await saveCallNote(userId, target.callId, text);
      toast.success("Catatan panggilan tersimpan.");
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan catatan.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!userId || !target) return;
    setBusy(true);
    try {
      await deleteCallNote(userId, target.callId);
      toast.success("Catatan dihapus.");
      onSaved?.();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus catatan.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent
        className="rounded-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          areaRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Catatan panggilan</DialogTitle>
          <DialogDescription>
            Catatan singkat untuk panggilan dengan {target?.peerName ?? "kontak"}. Hanya Anda yang
            bisa melihatnya.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={areaRef}
          value={text}
          maxLength={CALL_NOTE_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mis. sepakat kirim 5 kg besok pagi"
          className="min-h-28 rounded-xl"
          aria-label="Isi catatan panggilan"
        />
        <p className="text-right text-[11px] text-muted-foreground">
          {text.length}/{CALL_NOTE_MAX}
        </p>
        <DialogFooter className="gap-2 sm:justify-between">
          {target?.note ? (
            <Button
              variant="ghost"
              className="rounded-xl text-destructive"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="size-4" /> Hapus
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl" disabled={busy} onClick={close}>
              Batal
            </Button>
            <Button
              className="rounded-xl"
              disabled={busy || !text.trim()}
              onClick={() => void save()}
            >
              Simpan
            </Button>
          </div>
        </DialogFooter>
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="Hapus catatan?"
          description="Catatan panggilan ini akan dihapus permanen dan tidak bisa dikembalikan."
          confirmLabel="Hapus"
          destructive
          onConfirm={() => {
            setConfirmRemove(false);
            void remove();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}