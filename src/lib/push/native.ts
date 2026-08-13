/**
 * Jembatan push native (Capacitor + FCM).
 *
 * Plugin Capacitor dimuat dinamis lewat specifier variabel sehingga bundle web
 * tetap bisa di-build walau paket native belum terpasang / dijalankan di browser.
 */
import { supabase } from "@/integrations/supabase/client";
import { CHANNELS } from "./payload";
import { routeFromPush } from "./deeplink";
import type { PushData } from "./payload";

type AnyPlugin = Record<string, (...args: never[]) => Promise<unknown>> & {
  addListener?: (event: string, cb: (payload: never) => void) => Promise<unknown>;
};

export const ACTION_TOKEN_KEY = "mcm_action_token";

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * Apakah receiver latar native benar-benar terpasang di APK ini.
 *
 * Ini kapabilitas TERPISAH dari "FCM sudah dikonfigurasi" dan "token perangkat
 * terdaftar". Pengiriman saat proses aplikasi dimatikan hanya mungkin bila
 * wadah Android menyertakan `FirebaseMessagingService` MCM, yang wajib
 * menandai dirinya lewat `window.MCMNative.backgroundReceiver = true`.
 * Selama penanda itu tidak ada, aplikasi TIDAK boleh mengklaim kemampuan itu.
 */
export function nativeReceiverInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as unknown as { MCMNative?: { backgroundReceiver?: boolean } }).MCMNative;
  return isNative() && bridge?.backgroundReceiver === true;
}

async function loadPlugin(name: string): Promise<AnyPlugin | null> {
  try {
    const mod = (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
    const key = Object.keys(mod).find((k) => k !== "default");
    return (key ? (mod[key] as AnyPlugin) : null) ?? null;
  } catch {
    return null;
  }
}

/** Simpan kredensial aksi perangkat di Keystore/EncryptedSharedPreferences. */
async function storeActionToken(token: string) {
  const secure = await loadPlugin("@capacitor-community/secure-storage-plugin");
  if (secure && typeof (secure as unknown as { set?: unknown }).set === "function") {
    await (secure as unknown as { set: (o: unknown) => Promise<unknown> }).set({
      key: ACTION_TOKEN_KEY,
      value: token,
    });
    return true;
  }
  const prefs = await loadPlugin("@capacitor/preferences");
  if (prefs && typeof (prefs as unknown as { set?: unknown }).set === "function") {
    // Fallback hanya untuk build dev; produksi wajib memakai secure storage.
    await (prefs as unknown as { set: (o: unknown) => Promise<unknown> }).set({
      key: ACTION_TOKEN_KEY,
      value: token,
    });
    return true;
  }
  return false;
}

async function clearActionToken() {
  for (const name of ["@capacitor-community/secure-storage-plugin", "@capacitor/preferences"]) {
    const plugin = await loadPlugin(name);
    const remove = (plugin as unknown as { remove?: (o: unknown) => Promise<unknown> } | null)
      ?.remove;
    if (remove) await remove({ key: ACTION_TOKEN_KEY }).catch(() => undefined);
  }
}

/** Buat seluruh channel Android dengan nama berbahasa Indonesia. */
export async function ensureChannels(sound: boolean, vibrate: boolean) {
  const push = await loadPlugin("@capacitor/push-notifications");
  const create = (push as unknown as { createChannel?: (o: unknown) => Promise<unknown> } | null)
    ?.createChannel;
  if (!create) return;
  for (const ch of Object.values(CHANNELS)) {
    await create({
      id: ch.id,
      name: ch.name,
      importance: ch.importance,
      visibility: 0,
      sound: sound ? undefined : "",
      vibration: vibrate,
    }).catch(() => undefined);
  }
}

export type RegisterResult = { registered: boolean; reason?: string };

/**
 * Daftarkan token FCM perangkat ini dan ambil kredensial aksi sekali pakai.
 * Kredensial hanya dikembalikan saat registrasi dan langsung disimpan aman.
 */
export async function registerNativePush(deviceName: string): Promise<RegisterResult> {
  if (!isNative()) return { registered: false, reason: "bukan perangkat native" };
  const push = await loadPlugin("@capacitor/push-notifications");
  if (!push) return { registered: false, reason: "plugin push belum terpasang" };

  const perm = (
    await (
      push as unknown as { requestPermissions: () => Promise<{ receive: string }> }
    ).requestPermissions()
  ).receive;
  if (perm !== "granted") return { registered: false, reason: "izin notifikasi ditolak" };

  await ensureChannels(true, true);

  return await new Promise<RegisterResult>((resolve) => {
    void push.addListener?.("registration", (async (t: { value: string }) => {
      const { data, error } = await supabase.rpc("register_push_device", {
        _name: deviceName,
        _platform: "android",
        _push_token: t.value,
        _app_version: "",
      });
      if (error || !data) {
        resolve({ registered: false, reason: "gagal mendaftar perangkat" });
        return;
      }
      const payload = data as unknown as { action_token?: string };
      if (payload.action_token) await storeActionToken(payload.action_token);
      resolve({ registered: true });
    }) as never);
    void push.addListener?.("registrationError", (() =>
      resolve({ registered: false, reason: "registrasi FCM gagal" })) as never);
    void (push as unknown as { register: () => Promise<void> }).register();
  });
}

/** Cabut token & kredensial aksi saat logout atau perangkat dikeluarkan. */
export async function revokeNativePush() {
  await supabase.rpc("revoke_my_push_devices", {}).then(
    () => undefined,
    () => undefined,
  );
  await clearActionToken();
  const push = await loadPlugin("@capacitor/push-notifications");
  const remove = (
    push as unknown as { removeAllDeliveredNotifications?: () => Promise<void> } | null
  )?.removeAllDeliveredNotifications;
  if (remove) await remove().catch(() => undefined);
}

/** Bersihkan notifikasi satu percakapan setelah dibuka/dibaca. */
export async function clearConversationNotifications(conversationId: string) {
  const push = await loadPlugin("@capacitor/push-notifications");
  const list = (
    push as unknown as {
      getDeliveredNotifications?: () => Promise<{
        notifications: { id: string; data?: Record<string, string> }[];
      }>;
    } | null
  )?.getDeliveredNotifications;
  const removeSome = (
    push as unknown as { removeDeliveredNotifications?: (o: unknown) => Promise<void> } | null
  )?.removeDeliveredNotifications;
  if (!list || !removeSome) return;
  const delivered = await list().catch(() => null);
  const match = (delivered?.notifications ?? []).filter(
    (n) => n.data?.["conversationId"] === conversationId,
  );
  if (match.length > 0) await removeSome({ notifications: match }).catch(() => undefined);
}

/**
 * Pasang listener push saat aplikasi hidup: catat delivered secara nyata dan
 * tangani tap notifikasi menjadi deep link internal.
 */
export function attachPushListeners(navigateTo: (route: string) => void): () => void {
  let disposed = false;
  const removers: (() => void)[] = [];

  void (async () => {
    const push = await loadPlugin("@capacitor/push-notifications");
    if (!push || disposed) return;

    const received = await push.addListener?.("pushNotificationReceived", (async (n: {
      data?: PushData;
    }) => {
      const conv = n.data?.conversationId;
      // Perangkat benar-benar menerima event → delivered, bukan sekadar online.
      if (conv) await supabase.rpc("mark_messages_delivered", { _conv: conv });
    }) as never);

    const acted = await push.addListener?.("pushNotificationActionPerformed", (async (a: {
      notification?: { data?: PushData };
    }) => {
      const data = a.notification?.data;
      if (data?.conversationId) await clearConversationNotifications(data.conversationId);
      navigateTo(routeFromPush(data));
    }) as never);

    for (const handle of [received, acted]) {
      const remove = (handle as unknown as { remove?: () => Promise<void> } | undefined)?.remove;
      if (remove) removers.push(() => void remove());
    }
  })();

  return () => {
    disposed = true;
    for (const r of removers) r();
  };
}
