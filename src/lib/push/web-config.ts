/**
 * Konfigurasi Firebase Web (semuanya nilai PUBLIK — bukan secret).
 * Diisi lewat env build: lihat `.env.example`.
 */
const env = import.meta.env as unknown as Record<string, string | undefined>;

/**
 * Nilai proyek Firebase MCM: Private Connect (publik, sama dengan
 * `android/firebase/google-services.json`). Dipakai sebagai default supaya
 * build web hanya perlu tiga nilai khusus Web App: apiKey, appId, vapidKey.
 */
const DEFAULT_PROJECT_ID = "mcm-chat-b8e94";
const DEFAULT_SENDER_ID = "304269903025";

export const WEB_PUSH = {
  apiKey: env["VITE_FCM_API_KEY"] ?? "",
  projectId: env["VITE_FCM_PROJECT_ID"] || DEFAULT_PROJECT_ID,
  senderId: env["VITE_FCM_SENDER_ID"] || DEFAULT_SENDER_ID,
  appId: env["VITE_FCM_APP_ID"] ?? "",
  vapidKey: env["VITE_FCM_VAPID_KEY"] ?? "",
} as const;

/** Daftar env yang masih kosong (untuk diagnostik di UI, bukan secret). */
export function missingWebPushKeys(): string[] {
  const need: Array<[string, string]> = [
    ["VITE_FCM_API_KEY", WEB_PUSH.apiKey],
    ["VITE_FCM_PROJECT_ID", WEB_PUSH.projectId],
    ["VITE_FCM_SENDER_ID", WEB_PUSH.senderId],
    ["VITE_FCM_APP_ID", WEB_PUSH.appId],
    ["VITE_FCM_VAPID_KEY", WEB_PUSH.vapidKey],
  ];
  return need.filter(([, v]) => !v).map(([k]) => k);
}

/** True bila semua nilai konfigurasi web push tersedia. */
export function webPushConfigured(): boolean {
  return missingWebPushKeys().length === 0;
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
