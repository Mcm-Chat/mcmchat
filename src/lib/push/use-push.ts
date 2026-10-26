/**
 * Sesi push satu instance untuk seluruh aplikasi.
 *
 * Prinsip:
 * - TIDAK pernah memunculkan dialog izin hanya karena pengguna membuka
 *   halaman. Membuka aplikasi hanya menyegarkan perangkat aktif yang sudah
 *   terdaftar; instalasi baru atau yang dicabut harus diaktifkan secara
 *   eksplisit melalui `enablePush`.
 * - Listener push dipasang sekali di root, bukan per layar.
 * - Pendaftaran eksplisit idempoten per instalasi; penyegaran token tidak
 *   mengaktifkan kembali perangkat yang telah dicabut.
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
let activeUser: string | null = null;
let generation = 0;
let revision = 0;
let inFlight: { userId: string; promise: Promise<void> } | null = null;

function emit(patch: Partial<PushState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const snapshot = () => state;
const serverState: PushState = {
  native: false,
  receiverInstalled: false,
  webPush: false,
  permission: "unsupported",
  registered: false,
};
const serverSnapshot = () => serverState;

/** Automatic resume only refreshes an existing active registration; it never opts in. */
export async function refreshPushSession(userId: string): Promise<PushState> {
  if (activeUser !== userId || inFlight?.userId === userId) return state;
  const epoch = generation;
  const version = ++revision;
  const current = () => activeUser === userId && generation === epoch && revision === version;
  try {
    const permission = await checkPermission("notifications");
    if (!current()) return state;
    const native = isNative();
    const webPush = !native && webPushReady().ok;
    emit({ native, receiverInstalled: nativeReceiverInstalled(), webPush, permission });
    if (permission !== "granted" || (!native && !webPush)) {
      emit({ registered: false, reason: "Izin atau dukungan push perangkat belum tersedia." });
      return state;
    }
    const name = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "Android";
    const registered = native ? await syncRotatedToken(name) : await syncWebPushToken(name);
    if (current())
      emit({
        registered,
        reason: registered
          ? undefined
          : "Push belum aktif atau telah dicabut. Aktifkan kembali secara eksplisit di perangkat ini.",
      });
  } catch {
    if (current())
      emit({
        registered: false,
        reason: "Status pendaftaran push belum dapat diverifikasi. Periksa koneksi lalu coba lagi.",
      });
  }
  return state;
}

/** Opt-in from an explicit user gesture; this is the only registration/re-enable path. */
export async function enablePush(userId: string): Promise<PushState> {
  if (activeUser !== userId)
    return { ...state, registered: false, reason: "Sesi akun berubah. Muat ulang halaman." };
  if (inFlight?.userId === userId) {
    await inFlight.promise;
    return state;
  }
  const epoch = generation;
  ++revision; // Ignore background refreshes begun before the explicit opt-in.
  const current = () => activeUser === userId && generation === epoch;
  const promise = (async () => {
    if (!isNative()) {
      const ready = webPushReady();
      if (!ready.ok) {
        if (current()) emit({ registered: false, reason: ready.reason });
        return;
      }
    }
    const permission = await requestPermission("notifications");
    if (!current()) return;
    emit({ permission });
    if (permission !== "granted") {
      emit({ registered: false, reason: "Izin notifikasi belum diberikan." });
      return;
    }
    const name = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "Android";
    const res = isNative() ? await registerNativePush(name) : await registerWebPush(name);
    if (current()) emit({ registered: res.registered, reason: res.reason });
  })();
  inFlight = { userId, promise };
  try {
    await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
  return state;
}

export function resetPushSession() {
  activeUser = null;
  ++generation;
  ++revision;
  emit({ registered: false, reason: undefined });
}

/** Installed once in the root. Opening/resuming the app never creates or revives a device. */
export function usePushSession(userId?: string) {
  const navigate = useNavigate();
  useEffect(() => {
    resetPushSession();
    if (!userId) return;
    activeUser = userId;
    void refreshPushSession(userId);
    const onVisible = () => {
      if (document.visibilityState !== "hidden") void refreshPushSession(userId);
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("resume", onVisible);
    const detach = isNative()
      ? attachPushListeners((route) => void navigate({ to: route }))
      : attachWebPushListeners((route) => void navigate({ to: route }));
    return () => {
      resetPushSession();
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("resume", onVisible);
      detach();
    };
  }, [userId, navigate]);
}

/** Baca status push di layar mana pun tanpa efek samping. */
export function usePushState(): PushState {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Ensure native channels exist; Android owns their sound/vibration overrides. */
export function usePushChannels(prefs?: { sound: boolean; vibrate: boolean }) {
  const sound = prefs?.sound;
  const vibrate = prefs?.vibrate;
  useEffect(() => {
    if (sound === undefined || vibrate === undefined || !isNative()) return;
    void ensureChannels(sound, vibrate);
  }, [sound, vibrate]);
}
