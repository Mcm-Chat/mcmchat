/**
 * Push web (browser / PWA terpasang) via Firebase Cloud Messaging.
 *
 * Notifikasi saat aplikasi ditutup dirender oleh `public/firebase-messaging-sw.js`.
 * Semua fungsi gagal dengan aman bila browser tidak mendukung atau konfigurasi
 * belum diisi — tidak pernah mengklaim kemampuan yang tidak ada.
 */
import { supabase } from "@/integrations/supabase/client";
import { WEB_PUSH, swUrl, webPushConfigured } from "./web-config";
import { routeFromPush } from "./deeplink";
import type { PushData } from "./payload";
import { announceGuardResult, guardPushRoute } from "./route-guard";

const installationKey = "mcm.web.installation";

export type WebRegisterResult = { registered: boolean; reason?: string };

/** Browser mendukung service worker + Push API. */
export function webPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export function webPushReady(): { ok: boolean; reason?: string } {
  if (!webPushSupported()) return { ok: false, reason: "browser tidak mendukung push web" };
  if (!webPushConfigured()) return { ok: false, reason: "konfigurasi Firebase Web belum diisi" };
  return { ok: true };
}

/** ID instalasi stabil per-browser (non-secret) untuk dedupe baris perangkat. */
function installationId(): string {
  let id = localStorage.getItem(installationKey);
  if (!id || id.length < 8) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(installationKey, id);
  }
  return id;
}

async function swRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register(swUrl(), { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

async function messagingToken(): Promise<string | null> {
  const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, isSupported }] =
    await Promise.all([import("firebase/app"), import("firebase/messaging")]);
  if (!(await isSupported())) return null;
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: WEB_PUSH.apiKey,
        projectId: WEB_PUSH.projectId,
        messagingSenderId: WEB_PUSH.senderId,
        appId: WEB_PUSH.appId,
      });
  const registration = await swRegistration();
  return await getToken(getMessaging(app), { vapidKey: WEB_PUSH.vapidKey, serviceWorkerRegistration: registration });
}

/** Minta izin (harus dari gestur pengguna), ambil token, daftarkan perangkat. */
export async function registerWebPush(deviceName: string): Promise<WebRegisterResult> {
  const ready = webPushReady();
  if (!ready.ok) return { registered: false, ...(ready.reason ? { reason: ready.reason } : {}) };
  try {
    const perm =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (perm !== "granted") return { registered: false, reason: "izin notifikasi ditolak" };

    const token = await messagingToken();
    if (!token) return { registered: false, reason: "token push web tidak tersedia" };

    const { error } = await supabase.rpc("register_push_device", {
      _installation_id: installationId(),
      _name: deviceName,
      _platform: "web",
      _push_token: token,
      _app_version: "",
    });
    if (error) return { registered: false, reason: "gagal mendaftar perangkat" };
    return { registered: true };
  } catch {
    return { registered: false, reason: "pendaftaran push web gagal" };
  }
}

/** Cabut instalasi browser ini (dipanggil saat logout). */
export async function revokeWebPush() {
  if (typeof window === "undefined") return;
  const id = localStorage.getItem(installationKey);
  if (id) {
    await supabase.rpc("revoke_my_push_installation", { _installation_id: id }).then(
      () => undefined,
      () => undefined,
    );
  }
}

/**
 * Pesan foreground + navigasi dari klik notifikasi latar.
 * Mengembalikan fungsi pembersih.
 */
export function attachWebPushListeners(navigateTo: (route: string) => void): () => void {
  if (!webPushSupported()) return () => undefined;
  const onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; route?: string } | null;
    if (data?.type !== "mcm-push-route") return;
    // Balas segera: service worker memakai ack ini untuk memutuskan apakah
    // perlu memaksa navigasi penuh (tab ada tapi aplikasi belum siap).
    e.ports[0]?.postMessage({ type: "mcm-push-route-ack" });

    const route = routeFromPush({ route: data.route } as Partial<PushData>);
    void (async () => {
      const guarded = await guardPushRoute(route);
      announceGuardResult(guarded);
      const conv = guarded.blocked ? null : /^\/chat\/([0-9a-f-]{36})/i.exec(guarded.route)?.[1];
      if (conv) {
        await supabase.rpc("mark_messages_delivered", { _conv: conv }).then(
          () => undefined,
          () => undefined,
        );
        const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
        const notes = (await reg?.getNotifications({ tag: conv }).catch(() => [])) ?? [];
        for (const n of notes) n.close();
      }
      navigateTo(guarded.route);
    })();
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
