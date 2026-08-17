/**
 * Sesi push satu instance untuk seluruh aplikasi.
 *
 * Prinsip:
 * - TIDAK pernah memunculkan dialog izin hanya karena pengguna membuka
 *   halaman. Registrasi otomatis hanya dilakukan bila izin memang sudah
 *   diberikan sebelumnya; selebihnya UI menampilkan CTA dan pengguna sendiri
 *   yang menekannya (`enablePush`).
 * - Listener push dipasang sekali di root, bukan per layar.
 * - Registrasi token idempoten: satu kali per sesi pengguna, tidak dirotasi
 *   setiap render/navigasi.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  attachPushListeners,
  ensureChannels,
  isNative,
  nativeReceiverInstalled,
  registerNativePush,
  syncRotatedToken,
} from "./native";
import { checkPermission, requestPermission } from "./permissions";
import { attachWebPushListeners, registerWebPush, syncWebPushToken, webPushReady } from "./web";

export type PushState = {
  /** Berjalan di wadah Android/Capacitor, bukan tab browser. */
  native: boolean;
  /** Receiver latar native terpasang (syarat pengiriman saat aplikasi ditutup). */
  receiverInstalled: boolean;
  /** Push web (service worker FCM) tersedia & terkonfigurasi di browser ini. */
  webPush: boolean;
  permission: "granted" | "prompt" | "denied" | "restricted" | "unsupported";
  registered: boolean;
  reason?: string | undefined;
};

let state: PushState = {
  native: false,
  receiverInstalled: false,
  webPush: false,
  permission: "unsupported",
  registered: false,
};
const listeners = new Set<() => void>();
let registeredForUser: string | null = null;
let inFlight: Promise<void> | null = null;

function emit(patch: Partial<PushState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const snapshot = () => state;
const serverSnapshot = (): PushState => ({
  native: false,
  receiverInstalled: false,
  webPush: false,
  permission: "unsupported",
  registered: false,
});

/** Daftarkan perangkat sekali per pengguna; aman dipanggil berulang. */
async function registerOnce(userId: string) {
  if (registeredForUser === userId) return drainRotatedToken();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const name = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "Android";
    // Native memakai plugin FCM di APK; browser/PWA memakai service worker web push.
    const res = isNative() ? await registerNativePush(name) : await registerWebPush(name);
    if (res.registered) registeredForUser = userId;
    emit({
      registered: res.registered,
      ...(res.reason ? { reason: res.reason } : { reason: undefined }),
    });
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * `onNewToken` menyimpan token baru secara lokal saat aplikasi mati. Setelah
 * sesi tersedia, token tertunda WAJIB disinkronkan — termasuk ketika perangkat
 * sudah pernah terdaftar pada sesi ini (registeredForUser sudah true).
 */
async function drainRotatedToken() {
  const name = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "Android";
  if (!isNative()) {
    // Web/PWA: token FCM bisa berotasi atau dicabut browser tanpa event apa pun,
    // jadi token aktif dibandingkan dengan yang tersimpan setiap kali sesi hidup.
    const ok = await syncWebPushToken(name).catch(() => false);
    if (ok) emit({ registered: true, reason: undefined });
    return;
  }
  const synced = await syncRotatedToken(name).catch(() => false);
  if (synced) emit({ registered: true, reason: undefined });
}

/** Opt-in kontekstual: HANYA dipanggil dari gestur pengguna (tombol di pengaturan). */
export async function enablePush(userId: string): Promise<PushState> {
  if (!isNative()) {
    const ready = webPushReady();
    if (!ready.ok) {
      emit({ registered: false, ...(ready.reason ? { reason: ready.reason } : {}) });
      return state;
    }
  }
  const perm = await requestPermission("notifications");
  emit({ permission: perm });
  if (perm === "granted") await registerOnce(userId);
  return state;
}

export function resetPushSession() {
  registeredForUser = null;
  emit({ registered: false, reason: undefined });
}

/**
 * Dipasang SEKALI di root. Tidak meminta izin apa pun.
 */
export function usePushSession(userId?: string) {
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const perm = await checkPermission("notifications");
      if (!alive) return;
      emit({
        native: isNative(),
        receiverInstalled: nativeReceiverInstalled(),
        webPush: !isNative() && webPushReady().ok,
        permission: perm,
      });
      // Registrasi otomatis hanya bila izin sudah diberikan sebelumnya.
      if (userId && isNative() && perm === "granted") {
        await registerOnce(userId);
        // Rotasi tertunda selalu dikuras, walau registrasi sudah pernah terjadi.
        await drainRotatedToken();
      }
      // Browser/PWA: token web hanya didaftarkan bila izin sudah diberikan.
      if (userId && !isNative() && perm === "granted" && webPushReady().ok) {
        await registerOnce(userId);
        await drainRotatedToken();
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  // Perangkat asli sering menutup lalu membuka kembali aplikasi. Setiap kali tab
  // kembali terlihat, token diverifikasi ulang agar baris perangkat di server
  // tidak basi saat notifikasi dikirim ketika aplikasi ditutup.
  useEffect(() => {
    if (!userId || typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void drainRotatedToken();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const detach = isNative()
      ? attachPushListeners((route) => void navigate({ to: route }))
      : attachWebPushListeners((route) => void navigate({ to: route }));
    return detach;
  }, [userId, navigate]);

  useEffect(() => {
    if (!userId) resetPushSession();
  }, [userId]);
}

/** Baca status push di layar mana pun tanpa efek samping. */
export function usePushState(): PushState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Sinkronkan channel Android dengan preferensi suara/getar pengguna. */
export function usePushChannels(prefs?: { sound: boolean; vibrate: boolean }) {
  useEffect(() => {
    if (!prefs || !isNative()) return;
    void ensureChannels(prefs.sound, prefs.vibrate);
  }, [prefs?.sound, prefs?.vibrate]);
}
