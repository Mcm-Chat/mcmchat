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
/** Token terakhir yang sudah tersimpan di server + kapan disegarkan. */
const tokenKey = "mcm.web.push-token";
/** Token FCM web bisa berotasi diam-diam; segarkan minimal sekali sehari. */
const REFRESH_MS = 24 * 60 * 60 * 1000;

export type WebRegisterResult = { registered: boolean; reason?: string };

type TokenRecord = { token: string; at: number };

function readTokenRecord(): TokenRecord | null {
  try {
    const raw = localStorage.getItem(tokenKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TokenRecord>;
    if (typeof parsed.token !== "string" || typeof parsed.at !== "number") return null;
    return { token: parsed.token, at: parsed.at };
  } catch {
    return null;
  }
}

function writeTokenRecord(token: string) {
  try {
    localStorage.setItem(tokenKey, JSON.stringify({ token, at: Date.now() } satisfies TokenRecord));
  } catch {
    /* penyimpanan penuh/diblokir: registrasi tetap jalan, hanya kehilangan cache */
  }
}

function clearTokenRecord() {
  try {
    localStorage.removeItem(tokenKey);
  } catch {
    /* abaikan */
  }
}

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

async function messagingInstance() {
  const [{ initializeApp, getApps, getApp }, { getMessaging, isSupported }] = await Promise.all([
    import("firebase/app"),
    import("firebase/messaging"),
  ]);
  if (!(await isSupported())) return null;
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: WEB_PUSH.apiKey,
        projectId: WEB_PUSH.projectId,
        messagingSenderId: WEB_PUSH.senderId,
        appId: WEB_PUSH.appId,
      });
  return getMessaging(app);
}

async function messagingToken(): Promise<string | null> {
  const messaging = await messagingInstance();
  if (!messaging) return null;
  const { getToken } = await import("firebase/messaging");
  const registration = await swRegistration();
  return await getToken(messaging, {
    vapidKey: WEB_PUSH.vapidKey,
    serviceWorkerRegistration: registration,
  });
}

/** Simpan/perbarui baris perangkat memakai installation id sebagai kunci dedupe. */
async function upsertDevice(deviceName: string, token: string): Promise<boolean> {
  const { error } = await supabase.rpc("register_push_device", {
    _installation_id: installationId(),
    _name: deviceName,
    _platform: "web",
    _push_token: token,
    _app_version: "",
  });
  if (error) return false;
  writeTokenRecord(token);
  return true;
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

    if (!(await upsertDevice(deviceName, token)))
      return { registered: false, reason: "gagal mendaftar perangkat" };
    return { registered: true };
  } catch {
    return { registered: false, reason: "pendaftaran push web gagal" };
  }
}

/**
 * Sinkronisasi token perangkat asli: dipanggil saat aplikasi dibuka kembali dan
 * saat tab kembali aktif. TIDAK pernah memunculkan dialog izin — hanya berjalan
 * bila izin sudah diberikan. Menulis ke server hanya bila token berubah atau
 * cache sudah lebih tua dari 24 jam, supaya baris perangkat tetap segar
 * (token FCM web bisa dicabut/berotasi tanpa pemberitahuan).
 */
export async function syncWebPushToken(deviceName: string): Promise<boolean> {
  if (!webPushReady().ok) return false;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const token = await messagingToken();
    if (!token) return false;
    const cached = readTokenRecord();
    const fresh = cached && cached.token === token && Date.now() - cached.at < REFRESH_MS;
    if (fresh) return true;
    return await upsertDevice(deviceName, token);
  } catch {
    return false;
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
  clearTokenRecord();
  // Token lama dibatalkan di sisi FCM supaya perangkat ini benar-benar berhenti
  // menerima kiriman, bukan sekadar hilang dari daftar.
  try {
    const messaging = await messagingInstance();
    if (messaging) {
      const { deleteToken } = await import("firebase/messaging");
      await deleteToken(messaging);
    }
  } catch {
    /* browser tanpa dukungan/izin: cukup pencabutan sisi server */
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
