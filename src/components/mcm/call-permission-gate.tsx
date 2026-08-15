/**
 * Panel izin mikrofon/kamera di layar panggilan masuk.
 *
 * Tampil hanya ketika izin belum ada. Selama itu tombol "Jawab" dinonaktifkan,
 * jadi panel ini wajib memberi jalan keluar: minta izin, periksa ulang setelah
 * diubah lewat pengaturan, atau tolak panggilan tanpa menggantung.
 */
import { Mic, ShieldAlert, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseMediaPermission } from "@/lib/calls/use-media-permission";

export function CallPermissionGate({
  permission,
  onDecline,
}: {
  permission: UseMediaPermission;
  onDecline?: () => void;
}) {
  // Mode suara saja tetap ditampilkan (informatif): panggilan bisa dijawab,
  // tetapi pengguna harus tahu kameranya mati.
  if (permission.state === "checking") return null;
  if (permission.ready && !permission.audioOnly) return null;
  const { copy } = permission;
  const blocked = permission.state === "denied" || permission.state === "unsupported";

  return (
    <div
      role="alert"
      className="mx-auto mb-4 w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-3 text-left text-white"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        {blocked ? (
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
        ) : permission.audioOnly ? (
          <VideoOff className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Mic className="size-4 shrink-0" aria-hidden="true" />
        )}
        {copy.title}
      </p>
      {copy.help ? <p className="mt-1 text-xs text-white/75">{copy.help}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {copy.action ? (
          <Button
            size="sm"
            className="rounded-xl"
            disabled={permission.requesting}
            onClick={() => void permission.request()}
          >
            {permission.requesting ? "Meminta izin…" : copy.action}
          </Button>
        ) : null}
        {blocked && onDecline ? (
          <Button size="sm" variant="secondary" className="rounded-xl" onClick={onDecline}>
            Tolak panggilan
          </Button>
        ) : null}
      </div>
    </div>
  );
}
