/**
 * Jembatan push native MCM (Capacitor + FCM).
 *
 * Semua kapabilitas berasal dari plugin native `McmPush` yang benar-benar ada
 * di dalam APK (`android/app/src/main/java/com/mcm/privateconnect/McmPushPlugin.kt`).
 * Di browser plugin tidak tersedia dan seluruh fungsi di sini gagal dengan aman
 * — aplikasi TIDAK PERNAH mengklaim kemampuan latar yang tidak dimiliki.
 */
import { registerPlugin } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { routeFromPush } from "./deeplink";
import type { PushData } from "./payload";

export const ACTION_TOKEN_KEY = "mcm_action_token";

export type NativeCapabilities = {
  backgroundReceiver: boolean;
  permissionGranted: boolean;
  channels: string[];
  requiredChannels: string[];
  fullScreenIntent: boolean;
  batteryUnrestricted: boolean;
  firebaseConfigured: boolean;
};

type McmPushPlugin = {
  requestPermission(): Promise<{ granted: boolean }>;
  getToken(): Promise<{ token: string | null; reason?: string }>;
  clearAllNotifications(): Promise<void>;
  openFullScreenIntentSettings(): Promise<{ opened: boolean }>;
  consumePendingCallAnswer(): Promise<{
    callId: string | null;
    token: string | null;
    actionId: string | null;
  }>;
  startCallForeground(o: { callId: string; title?: string }): Promise<void>;
  stopCallForeground(): Promise<void>;
  capabilities(): Promise<NativeCapabilities>;
  openNotificationSettings(): Promise<void>;
  openBatterySettings(): Promise<{ opened: boolean }>;
  sendTestNotification(): Promise<{ shown: boolean; reason?: string }>;
  clearConversationNotifications(o: { conversationId: string }): Promise<void>;
  consumePendingRoute(): Promise<{ route: string | null }>;
  consumePendingFcmToken(): Promise<{ token: string | null }>;
  getInstallationId(): Promise<{ installationId: string }>;
};

const McmPush = registerPlugin<McmPushPlugin>("McmPush");

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Apakah receiver latar native benar-benar ada di APK ini.
 *
 * Penanda ditulis oleh `MainActivity` hanya bila kelas native memang terpasang;
 * di web selalu `false`.
 */
export function nativeReceiverInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { MCMNative?: { backgroundReceiver?: boolean } }).MCMNative;
  return isNative() && bridge?.backgroundReceiver === true;
}

/** Dialog izin notifikasi Android 13+ (hanya dari gestur pengguna). */
export async function requestNativeNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await McmPush.requestPermission()).granted;
  } catch {
    return false;
  }
}

/** Status kapabilitas nyata untuk halaman diagnostik. */
export async function pushCapabilities(): Promise<NativeCapabilities | null> {
  if (!isNative()) return null;
  try {
    return await McmPush.capabilities();
  } catch {
    return null;
  }
}

/**
 * Channel dibuat oleh sisi native saat plugin dimuat (`McmNotifications.ensure`).
 * Setelan suara/getar per channel hanya bisa diubah pengguna lewat Pengaturan
 * Android, jadi fungsi ini hanya memastikan channel ada.
 */
export async function ensureChannels(_sound?: boolean, _vibrate?: boolean) {
  if (!isNative()) return;
  await McmPush.capabilities().catch(() => null);
}

export type RegisterResult = { registered: boolean; reason?: string };

/**
 * ID instalasi stabil (non-secret) yang dibuat sekali oleh lapisan native dan
 * bertahan selama aplikasi terpasang. Dedupe perangkat memakai ID ini, bukan
 * token FCM yang bisa berotasi kapan saja.
 */
export async function installationId(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { installationId: id } = await McmPush.getInstallationId();
    return id && id.length >= 8 ? id : null;
  } catch {
    return null;
  }
}

async function upsertDevice(
  deviceName: string,
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  const install = await installationId();
  if (!install) return { ok: false, reason: "id instalasi perangkat tidak tersedia" };
  const { error } = await supabase.rpc("register_push_device", {
    _installation_id: install,
    _name: deviceName,
    _platform: "android",
    _push_token: token,
    _app_version: "",
  });
  if (error) return { ok: false, reason: "gagal mendaftar perangkat" };
  return { ok: true };
}

/**
 * Minta izin POST_NOTIFICATIONS, ambil token FCM, daftarkan perangkat, lalu
 * simpan kredensial aksi ke Android Keystore. Token auth Supabase TIDAK PERNAH
 * dikirim ke lapisan native.
 */
export async function registerNativePush(deviceName: string): Promise<RegisterResult> {
  if (!isNative()) return { registered: false, reason: "bukan perangkat native" };
  try {
    const perm = await McmPush.requestPermission();
    if (!perm.granted) return { registered: false, reason: "izin notifikasi ditolak" };

    const { token } = await McmPush.getToken();
    if (!token) return { registered: false, reason: "Firebase belum dikonfigurasi di aplikasi" };

    const res = await upsertDevice(deviceName, token);
    if (!res.ok) return { registered: false, ...(res.reason ? { reason: res.reason } : {}) };
    // Tidak ada kredensial aksi persisten: token dikirim per notifikasi.
    return { registered: true };
  } catch {
    return { registered: false, reason: "jembatan push native tidak tersedia" };
  }
}

/**
 * Rotasi token: dipanggil saat aplikasi dibuka setelah `onNewToken`.
 * Karena dedupe memakai installation id, rotasi memperbarui baris yang sama.
 */
export async function syncRotatedToken(deviceName: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const { token } = await McmPush.consumePendingFcmToken();
    if (!token) return false;
    const res = await upsertDevice(deviceName, token);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Logout normal: HANYA cabut instalasi saat ini. Perangkat lain milik akun
 * tetap menerima notifikasi.
 */
export async function revokeNativePush() {
  const install = await installationId();
  if (install) {
    await supabase.rpc("revoke_my_push_installation", { _installation_id: install }).then(
      () => undefined,
      () => undefined,
    );
  }
  if (!isNative()) return;
  await McmPush.clearAllNotifications().catch(() => undefined);
}

/** Opsi eksplisit "Keluar dari semua perangkat". */
export async function revokeAllNativePush() {
  await supabase.rpc("revoke_my_push_devices").then(
    () => undefined,
    () => undefined,
  );
  if (!isNative()) return;
  await McmPush.clearAllNotifications().catch(() => undefined);
}

/** Bersihkan notifikasi satu percakapan setelah dibuka/dibaca. */
export async function clearConversationNotifications(conversationId: string) {
  if (!isNative()) return;
  await McmPush.clearConversationNotifications({ conversationId }).catch(() => undefined);
}

export async function sendTestNotification(): Promise<{ shown: boolean; reason?: string }> {
  if (!isNative()) return { shown: false, reason: "hanya tersedia di aplikasi Android" };
  try {
    return await McmPush.sendTestNotification();
  } catch {
    return { shown: false, reason: "jembatan push native tidak tersedia" };
  }
}

export async function openNotificationSettings() {
  if (!isNative()) return;
  await McmPush.openNotificationSettings().catch(() => undefined);
}

/** Buka setelan izin full-screen intent (Android 14+). */
export async function openFullScreenIntentSettings(): Promise<{ opened: boolean }> {
  if (!isNative()) return { opened: false };
  return await McmPush.openFullScreenIntentSettings().catch(() => ({ opened: false }));
}

/**
 * Aksi "Jawab" dari notifikasi panggilan.
 *
 * Notifikasi TIDAK memakai trampoline: PendingIntent-nya membuka Activity, lalu
 * lapisan web inilah yang menukar token sekali-pakai di endpoint aman. Media dan
 * foreground service hanya dimulai setelah server menerima aksi tersebut.
 */
export async function consumePendingCallAnswer(): Promise<{ callId: string } | null> {
  if (!isNative()) return null;
  try {
    const pending = await McmPush.consumePendingCallAnswer();
    if (!pending?.callId || !pending.token || !pending.actionId) return null;
    const res = await fetch("/api/public/push/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "answer",
        token: pending.token,
        callId: pending.callId,
        actionId: pending.actionId,
      }),
    });
    if (!res.ok) return null;
    await McmPush.startCallForeground({ callId: pending.callId, title: "Panggilan aktif" }).catch(
      () => undefined,
    );
    return { callId: pending.callId };
  } catch {
    return null;
  }
}

/** Hentikan foreground service panggilan saat panggilan berakhir. */
export async function stopCallForeground() {
  if (!isNative()) return;
  await McmPush.stopCallForeground().catch(() => undefined);
}

export async function openBatterySettings() {
  if (!isNative()) return { opened: false };
  return await McmPush.openBatterySettings().catch(() => ({ opened: false }));
}

/**
 * Rute deep link dari notifikasi yang membangunkan aplikasi (cold start) atau
 * dari tap saat aplikasi hidup (warm start).
 */
export async function consumePendingRoute(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { route } = await McmPush.consumePendingRoute();
    if (!route || !route.startsWith("/") || route.startsWith("//")) return null;
    return route;
  } catch {
    return null;
  }
}

/**
 * Pasang penanganan rute notifikasi. Notifikasi latar dirender sepenuhnya oleh
 * `PushDeliveryService`; lapisan web hanya mengambil rute tertunda dan mencatat
 * status delivered saat aplikasi hidup.
 */
export function attachPushListeners(navigateTo: (route: string) => void): () => void {
  if (!isNative()) return () => undefined;
  let disposed = false;

  const drain = async () => {
    // Jawab panggilan diproses lebih dulu: token sekali-pakai punya TTL pendek.
    const answered = await consumePendingCallAnswer();
    if (answered && !disposed) navigateTo(`/call/${answered.callId}`);
    const route = await consumePendingRoute();
    if (disposed || !route) return;
    const conv = /^\/chat\/([0-9a-f-]{36})/i.exec(route)?.[1];
    if (conv) {
      await supabase.rpc("mark_messages_delivered", { _conv: conv }).then(
        () => undefined,
        () => undefined,
      );
      await clearConversationNotifications(conv);
    }
    navigateTo(routeFromPush({ route } as Partial<PushData>));
  };

  void drain();
  const onResume = () => void drain();
  document.addEventListener("resume", onResume);
  document.addEventListener("visibilitychange", onResume);

  return () => {
    disposed = true;
    document.removeEventListener("resume", onResume);
    document.removeEventListener("visibilitychange", onResume);
  };
}
