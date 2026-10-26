import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { checkPermission, openAppSettings, type PermState } from "@/lib/push/permissions";
import { enablePush, usePushState } from "@/lib/push/use-push";

const TONE: Record<PermState, string> = {
  granted: "bg-success/15 text-success",
  denied: "bg-destructive/15 text-destructive",
  restricted: "bg-destructive/15 text-destructive",
  prompt: "bg-warning/20 text-warning",
  unsupported: "bg-muted text-muted-foreground",
};
const LABEL: Record<PermState, string> = {
  granted: "Diizinkan",
  denied: "Diblokir",
  restricted: "Dibatasi",
  prompt: "Belum diizinkan",
  unsupported: "Tidak didukung",
};

/** Permission and registration are separate; only an explicit gesture may opt in a device. */
export function NotificationPermissionRow({ userId }: { userId?: string | undefined }) {
  const push = usePushState();
  const [perm, setPerm] = useState<PermState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const mounted = useRef(false);
  const request = useRef(0);

  const refreshPermission = useCallback(async () => {
    const token = ++request.current;
    try {
      const next = await checkPermission("notifications");
      if (mounted.current && token === request.current) {
        setPerm(next);
        setError(null);
      }
    } catch (err) {
      if (mounted.current && token === request.current) {
        setError(err instanceof Error ? err.message : "Izin notifikasi belum dapat diperiksa.");
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshPermission();
    const onResume = () => {
      if (document.visibilityState !== "hidden") void refreshPermission();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    document.addEventListener("resume", onResume);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      document.removeEventListener("resume", onResume);
    };
  }, [push.permission, refreshPermission]);

  useEffect(() => {
    setBusy(false);
  }, [userId]);

  const ask = async () => {
    if (!userId || !perm || busy) return;
    const owner = userId;
    const current = () => mounted.current && currentUser.current === owner;
    setBusy(true);
    try {
      if (perm === "denied" || perm === "restricted") {
        const opened = await openAppSettings();
        if (current() && !opened)
          toast.info(
            "Buka pengaturan situs/aplikasi pada perangkat ini untuk mengizinkan notifikasi.",
          );
        return;
      }
      const next = await enablePush(owner);
      if (!current()) return;
      setPerm(next.permission);
      if (next.permission !== "granted") toast.info("Izin notifikasi belum diberikan.");
      else if (!next.registered) toast.error(next.reason ?? "Pendaftaran perangkat gagal.");
      else
        toast.success("Token push perangkat terdaftar. Uji pengiriman untuk memeriksa penerimaan.");
    } catch (err) {
      if (current())
        toast.error(err instanceof Error ? err.message : "Gagal mengaktifkan push perangkat.");
    } finally {
      if (current()) setBusy(false);
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
          {perm === null
            ? "Memeriksa izin perangkat…"
            : perm === "granted"
              ? push.registered
                ? "Token perangkat terdaftar. Gunakan uji pengiriman untuk memeriksa penerimaan."
                : "Izin diberikan. Push perangkat belum terdaftar atau sudah dicabut; daftarkan secara eksplisit."
              : perm === "denied" || perm === "restricted"
                ? "Izin diblokir atau dibatasi perangkat. Ubah melalui pengaturan situs/aplikasi."
                : perm === "unsupported"
                  ? "Izin push belum tersedia di browser atau build ini."
                  : "Izinkan notifikasi dan daftarkan perangkat untuk menerima push."}
        </p>
        {error ? (
          <div role="alert" className="mt-2 space-y-1">
            <p className="text-xs text-destructive">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 text-xs"
              onClick={() => void refreshPermission()}
            >
              Periksa izin lagi
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1.5">
        <Badge
          variant="secondary"
          className={`max-w-full whitespace-normal text-right ${TONE[perm ?? "unsupported"]}`}
        >
          {perm ? LABEL[perm] : error ? "Belum diketahui" : "Memeriksa…"}
        </Badge>
        {perm && perm !== "unsupported" && userId && (perm !== "granted" || !push.registered) ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 h-auto whitespace-normal rounded-lg px-3 py-2 text-xs"
            disabled={busy || Boolean(error)}
            onClick={() => void ask()}
          >
            {busy
              ? "Memproses…"
              : perm === "denied" || perm === "restricted"
                ? "Buka setelan"
                : perm === "granted"
                  ? "Daftarkan perangkat"
                  : "Izinkan & daftarkan"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
