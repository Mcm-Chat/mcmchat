import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogIn, MessageSquare, ShieldAlert, UserPlus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { onPushDenied, type PushDeniedCode, type PushDeniedNotice } from "@/lib/push/denied-notice";

type Cta = { label: string; route: string; icon: typeof LogIn };

/** CTA utama sesuai alasan penolakan; rute cadangan dipakai bila tidak ada. */
function ctaFor(notice: PushDeniedNotice): Cta {
  const q = notice.conversationId
    ? `?conv=${encodeURIComponent(notice.conversationId)}&reason=${notice.code}`
    : `?reason=${notice.code}`;
  const map: Partial<Record<PushDeniedCode, Cta>> = {
    no_session: { label: "Masuk ulang", route: "/login", icon: LogIn },
    not_member: { label: "Minta akses ke kontak", route: `/contacts/add${q}`, icon: UserPlus },
    removed: { label: "Minta akses ke kontak", route: `/contacts/add${q}`, icon: UserPlus },
    blocked: { label: "Kelola blokir kontak", route: "/contacts", icon: UserPlus },
  };
  return (
    map[notice.code] ?? {
      label: "Buka daftar chat",
      route: notice.fallbackRoute || "/chat",
      icon: MessageSquare,
    }
  );
}

/**
 * Modal penjelasan saat klik notifikasi push tidak boleh membuka percakapan.
 * Persisten: hanya tertutup lewat tombol di dalamnya (bukan klik luar/Escape),
 * dan selalu menawarkan satu langkah lanjutan yang jelas.
 */
export function PushDeniedDialog() {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<PushDeniedNotice | null>(null);

  useEffect(() => onPushDenied(setNotice), []);

  const go = (route: string) => {
    setNotice(null);
    void navigate({ to: route, replace: true }).catch(() => undefined);
  };

  const cta = notice ? ctaFor(notice) : null;
  const Icon = cta?.icon ?? MessageSquare;
  const fallback = notice?.fallbackRoute || "/chat";
  const showSecondary = !!cta && cta.route !== fallback;

  return (
    <AlertDialog open={!!notice}>
      <AlertDialogContent
        className="max-w-[22rem] rounded-2xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
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
        <div className="flex flex-col gap-2">
          <Button className="h-11 w-full rounded-xl" onClick={() => cta && go(cta.route)}>
            <Icon className="size-4" aria-hidden /> {cta?.label ?? "Buka daftar chat"}
          </Button>
          {showSecondary && (
            <Button variant="ghost" className="h-11 w-full rounded-xl" onClick={() => go(fallback)}>
              {fallback === "/login" ? "Nanti saja" : "Buka daftar chat"}
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
