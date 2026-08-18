import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { checkPermission, openAppSettings, type PermState } from "@/lib/push/permissions";
import { enablePush, usePushState } from "@/lib/push/use-push";

const TONE: Record<PermState, string> = {
  granted: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  denied: "bg-destructive/15 text-destructive",
  restricted: "bg-destructive/15 text-destructive",
  prompt: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  unsupported: "bg-muted text-muted-foreground",
};

const LABEL: Record<PermState, string> = {
  granted: "Aktif",
  denied: "Diblokir",
  restricted: "Dibatasi",
  prompt: "Belum diizinkan",
  unsupported: "Tidak didukung",
};

/**
 * Baris status izin notifikasi browser/perangkat. Izin HANYA diminta ketika
 * pengguna menekan tombol, tidak otomatis saat halaman dibuka.
 */
export function NotificationPermissionRow({ userId }: { userId?: string | undefined }) {
  const push = usePushState();
  const [perm, setPerm] = useState<PermState>("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void checkPermission("notifications").then(setPerm);
  }, [push.permission]);

  const state: PermState = push.permission !== "unsupported" ? push.permission : perm;

  const ask = async () => {
    if (!userId) return;
    if (state === "denied" || state === "restricted") {
      const opened = await openAppSettings();
      if (!opened)
        toast.info("Izin notifikasi diblokir. Buka setelan situs/aplikasi untuk mengizinkannya.");
      return;
    }
    setBusy(true);
    try {
      const next = await enablePush(userId);
      setPerm(next.permission);
      if (next.permission !== "granted") toast.info("Izin notifikasi belum diberikan.");
      else if (!next.registered) toast.error(next.reason ?? "Pendaftaran perangkat gagal.");
      else toast.success("Notifikasi aktif di perangkat ini");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-xl px-1 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Bell className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Izin notifikasi</p>
        <p className="text-xs text-muted-foreground">
          {state === "granted"
            ? push.registered
              ? "Perangkat ini terdaftar menerima notifikasi."
              : "Izin diberikan, perangkat sedang didaftarkan."
            : state === "denied" || state === "restricted"
              ? "Diblokir browser/perangkat — ubah lewat setelan situs."
              : "Aktifkan agar pesan, panggilan, dan catatan tetap masuk."}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge variant="secondary" className={TONE[state]}>
          {LABEL[state]}
        </Badge>
        {state !== "granted" && state !== "unsupported" && userId ? (
          <Button
            size="sm"
            variant="outline"
            className="h-10 rounded-lg text-xs sm:h-7"
            disabled={busy}
            onClick={() => void ask()}
          >
            {state === "denied" || state === "restricted" ? "Buka setelan" : "Izinkan"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
