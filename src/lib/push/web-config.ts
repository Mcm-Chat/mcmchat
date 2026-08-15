/**
 * Konfigurasi Firebase Web (semuanya nilai PUBLIK — bukan secret).
 * Diisi lewat env build: lihat `.env.example`.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

export const WEB_PUSH = {
  apiKey: env["VITE_FCM_API_KEY"] ?? "",
  projectId: env["VITE_FCM_PROJECT_ID"] ?? "",
  senderId: env["VITE_FCM_SENDER_ID"] ?? "",
  appId: env["VITE_FCM_APP_ID"] ?? "",
  vapidKey: env["VITE_FCM_VAPID_KEY"] ?? "",
} as const;

/** True bila semua nilai konfigurasi web push tersedia. */
export function webPushConfigured(): boolean {
  return Boolean(
    WEB_PUSH.apiKey && WEB_PUSH.projectId && WEB_PUSH.senderId && WEB_PUSH.appId && WEB_PUSH.vapidKey,
  );
}

/** URL service worker pesan latar, membawa config publik sebagai query. */
export function swUrl(): string {
  const q = new URLSearchParams({
    apiKey: WEB_PUSH.apiKey,
    projectId: WEB_PUSH.projectId,
    senderId: WEB_PUSH.senderId,
    appId: WEB_PUSH.appId,
  });
  return `/firebase-messaging-sw.js?${q.toString()}`;
}
