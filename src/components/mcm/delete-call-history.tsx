/**
 * Konfirmasi hapus riwayat panggilan (satu entri atau semua) dengan opsi
 * "Urungkan". Penghapusan hanya berlaku untuk akun ini — riwayat lawan bicara
 * tidak ikut hilang.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { hideCalls, unhideCalls } from "@/lib/api/call-history";

export type DeleteCallTarget = {
  /** Entri riwayat yang akan dihapus dari daftar pengguna ini. */
  ids: string[];
  /** Judul konfirmasi, mis. "Hapus panggilan dengan Budi?" */
  title: string;
  description?: string;
};

export function DeleteCallHistoryDialog({
  userId,
  target,
  onOpenChange,
  onDeleted,
}: {
  userId: string | undefined;
  target: DeleteCallTarget | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!userId || !target || target.ids.length === 0) return;
    const ids = target.ids;
    setBusy(true);
    try {
      await hideCalls(userId, ids);
      onOpenChange(false);
      onDeleted?.();
      toast.success(
        ids.length > 1 ? `${ids.length} riwayat panggilan dihapus` : "Riwayat panggilan dihapus",
        {
          description: "Hanya dihapus dari daftar Anda.",
          action: {
            label: "Urungkan",
            onClick: () => {
              void unhideCalls(userId, ids)
                .then(() => {
                  onDeleted?.();
                  toast.success("Riwayat panggilan dipulihkan");
                })
                .catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Gagal memulihkan riwayat"),
                );
            },
          },
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus riwayat panggilan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={!!target} onOpenChange={(o) => (o ? undefined : onOpenChange(false))}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{target?.title ?? "Hapus riwayat panggilan?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {target?.description ??
              "Entri ini hilang dari daftar panggilan Anda. Riwayat lawan bicara tidak terpengaruh."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11 rounded-xl" disabled={busy}>
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {busy ? "Menghapus…" : "Hapus"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Tombol ikon tong sampah standar untuk daftar/detail panggilan. */
export function DeleteCallIconButton({
  label,
  onClick,
  id,
}: {
  label: string;
  onClick: () => void;
  id?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 text-muted-foreground hover:text-destructive"
      aria-label={label}
      title={label}
      {...(id ? { id } : {})}
      onClick={onClick}
    >
      <Trash2 className="size-5" />
    </Button>
  );
}
