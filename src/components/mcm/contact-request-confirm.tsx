import { Send, ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/mcm/user-avatar";
import type { ProfileLite } from "@/lib/api/contacts";

const REASON_LABEL: Record<string, string> = {
  removed: "Anda dikeluarkan dari percakapan ini",
  not_member: "Anda bukan lagi peserta percakapan ini",
  blocked: "Percakapan ini sedang diblokir",
};

type Props = {
  open: boolean;
  profile: ProfileLite | null;
  message: string;
  /** Asal permintaan (dari CTA notifikasi) untuk ringkasan otomatis. */
  reason?: string | undefined;
  conversationId?: string | undefined;
  sending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

/**
 * Konfirmasi sekali tekan sebelum permintaan kontak dikirim: menampilkan
 * identitas tujuan, konteks percakapan, dan ringkasan pesan yang akan dikirim.
 */
export function ContactRequestConfirmDialog({
  open,
  profile,
  message,
  reason,
  conversationId,
  sending,
  onConfirm,
  onOpenChange,
}: Props) {
  const summary = message.trim() || "(tanpa pesan)";
  const context = reason ? REASON_LABEL[reason] : undefined;

  return (
    <AlertDialog open={open && !!profile} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <AlertDialogContent className="max-w-[22rem] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">Kirim permintaan kontak?</AlertDialogTitle>
          <AlertDialogDescription className="text-sm">
            Periksa tujuan dan isi pesan sebelum dikirim.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {profile && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <UserAvatar
                userId={profile.id}
                path={profile.avatar_url}
                version={profile.avatar_version}
                name={profile.display_name}
                color={profile.avatar_color}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{profile.display_name}</p>
                {profile.pin && (
                  <p className="font-mono text-xs text-muted-foreground">{profile.pin}</p>
                )}
              </div>
            </div>

            {(context || conversationId) && (
              <div className="rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <ShieldCheck className="size-3.5" aria-hidden /> Konteks percakapan
                </p>
                {context && <p className="mt-1">{context}</p>}
                {conversationId && (
                  <p className="mt-1 font-mono break-all">ID: {conversationId.slice(0, 8)}…</p>
                )}
              </div>
            )}

            <div className="rounded-xl border border-border/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">Pesan permintaan</p>
              <p className="mt-1 text-sm [overflow-wrap:anywhere]">{summary}</p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button className="h-11 w-full rounded-xl" onClick={onConfirm} disabled={sending}>
            <Send className="size-4" aria-hidden /> {sending ? "Mengirim…" : "Kirim sekarang"}
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Periksa lagi
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
