import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { resolveAppLink } from "./app-link";

/**
 * Pasang penanganan App Link `https://mcmchat.id/...` (dan skema `mcm://`).
 *
 * Cold start ditangani `MainActivity` lewat rute tertunda notifikasi; hook ini
 * menangani tautan yang dibuka saat aplikasi sudah hidup (`appUrlOpen`), lalu
 * memvalidasi izin percakapan sebelum menavigasi sehingga tautan usang tidak
 * berakhir di layar error.
 */
export function useAppLinks(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let remove: (() => void) | null = null;

    const open = async (url: string) => {
      const route = resolveAppLink(url);
      if (!route || disposed) return;
      const { announceGuardResult, guardPushRoute } = await import("@/lib/push/route-guard");
      const guarded = await guardPushRoute(route);
      if (disposed) return;
      announceGuardResult(guarded);
      void navigate({ to: guarded.route, replace: false });
    };

    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appUrlOpen", (event) => {
          void open(event.url);
        });
        if (disposed) void handle.remove();
        else remove = () => void handle.remove();
        const launch = await App.getLaunchUrl();
        if (launch?.url) void open(launch.url);
      } catch {
        /* plugin tidak tersedia di web: tautan ditangani router biasa */
      }
    })();

    return () => {
      disposed = true;
      remove?.();
    };
  }, [navigate]);
}
