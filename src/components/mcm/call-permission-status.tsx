/**
 * Kartu status izin mikrofon/kamera pada layar prapanggilan.
 *
 * Ditampilkan sebelum panggilan dibuat supaya pengguna mengaktifkan izin
 * lebih dulu — bukan setelah lawan bicara berdering dan suaranya sunyi.
 */
import { CheckCircle2, Loader2, Mic, ShieldAlert, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UseMediaPermission } from "@/lib/calls/use-media-permission";

export function CallPermissionStatus({
  permission,
  className,
}: {
  permission: UseMediaPermission;
  className?: string;
}) {
  const { state, copy } = permission;
  const tone =
    state === "granted"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      : state === "audio_only"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : state === "checking"
          ? "border-border bg-muted text-muted-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive";
  const Icon =
    state === "granted"
      ? CheckCircle2
      : state === "audio_only"
        ? VideoOff
        : state === "checking"
          ? Loader2
          : state === "prompt"
            ? Mic
            : ShieldAlert;

  return (
    <section
      role="status"
      aria-live="polite"
      className={cn("rounded-2xl border p-3", tone, className)}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className={cn("size-4 shrink-0", state === "checking" && "animate-spin")} />
        {copy.title}
      </p>
      {copy.help ? <p className="mt-1 text-xs opacity-90">{copy.help}</p> : null}
      {copy.action ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-3 min-h-9 rounded-xl"
          disabled={permission.requesting}
          onClick={() => void permission.request()}
        >
          {permission.requesting ? "Meminta izin…" : copy.action}
        </Button>
      ) : null}
    </section>
  );
}
