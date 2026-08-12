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
import { attachPushListeners, ensureChannels, isNative, nativeReceiverInstalled, registerNativePush } from "./native";
import { checkPermission, requestPermission } from "./permissions";

export type PushState = {
  /** Berjalan di wadah Android/Capacitor, bukan tab browser. */
  native: boolean;
  /** Receiver latar native terpasang (syarat pengiriman saat aplikasi ditutup). */
  receiverInstalled: boolean;
  permission: "granted" | "prompt" | "denied" | "restricted" | "unsupported";
  registered: boolean;
  reason?: string | undefined;
};

let state: PushState = { native: false, receiverInstalled: false, permission: "unsupported", registered: false };
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
  permission: "unsupported",
  registered: false,
});

/** Daftarkan perangkat sekali per pengguna; aman dipanggil berulang. */
async function registerOnce(userId: string) {
  if (registeredForUser === userId) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const res = await registerNativePush(
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "Android",
    );
    if (res.registered) registeredForUser = userId;
    emit({ registered: res.registered, ...(res.reason ? { reason: res.reason } : { reason: undefined }) });
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Opt-in kontekstual: HANYA dipanggil dari gestur pengguna (tombol di pengaturan). */
export async function enablePush(userId: string): Promise<PushState> {
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
      emit({ native: isNative(), receiverInstalled: nativeReceiverInstalled(), permission: perm });
      // Registrasi otomatis hanya bila izin sudah diberikan sebelumnya.
      if (userId && isNative() && perm === "granted") await registerOnce(userId);
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !isNative()) return;
    const detach = attachPushListeners((route) => void navigate({ to: route }));
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
