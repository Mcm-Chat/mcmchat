import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { onPushDenied, type PushDeniedNotice } from "@/lib/push/denied-notice";

/**
 * Modal penjelasan saat klik notifikasi push tidak boleh membuka percakapan.
 * Menjelaskan alasan spesifik lalu mengantar pengguna ke rute pengganti.
 */
export function PushDeniedDialog() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<PushDeniedNotice | null>(null);

  useEffect(() => onPushDenied(setNotice), []);

  const close = () => {
    const target = notice?.fallbackRoute;
    setNotice(null);
    if (target) void navigate({ to: target, replace: true }).catch(() => undefined);
  };

  return (
    <AlertDialog open={!!notice} onOpenChange={(open) => (!open ? close() : undefined)}>
      <AlertDialogContent className="max-w-[22rem] rounded-2xl">
        <AlertDialogHeader>
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <ShieldAlert className="size-5" aria-hidden />
          </div>
          <AlertDialogTitle className="text-center text-base">
            {notice?.title ?? "Akses ditolak"}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center text-sm">
            {notice?.detail}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className="w-full" onClick={close}>
            Mengerti
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
