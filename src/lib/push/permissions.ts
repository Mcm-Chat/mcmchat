/**
 * Status izin runtime lintas platform (web preview + Android/Capacitor).
 * Prinsip least privilege: izin hanya diminta saat fitur dipakai, tidak ada
 * background location, tidak ada akses seluruh file, tidak ada exact alarm.
 */
import {
  isNative,
  openNativeAppSettings,
  pushCapabilities,
  requestNativeNotificationPermission,
} from "./native";

export type PermState = "granted" | "prompt" | "denied" | "restricted" | "unsupported";

export type PermKey = "notifications" | "camera" | "microphone" | "location" | "photos";

export const PERM_LABEL: Record<PermKey, { title: string; desc: string }> = {
  notifications: { title: "Notifikasi", desc: "Pesan masuk, panggilan, tugas, dan pembayaran." },
  camera: { title: "Kamera", desc: "Diminta hanya saat Anda memotret produk atau bukti tugas." },
  microphone: { title: "Mikrofon", desc: "Diminta hanya saat merekam pesan suara atau panggilan." },
  location: {
    title: "Lokasi",
    desc: "Diminta hanya saat Anda melampirkan lokasi. Tidak pernah di latar belakang.",
  },
  photos: {
    title: "Foto & media",
    desc: "Gunakan pemilih foto saat melampirkan media; tidak perlu akses seluruh berkas.",
  },
};

export const STATE_LABEL: Record<PermState, string> = {
  granted: "Diizinkan",
  prompt: "Perlu izin / pemeriksaan",
  denied: "Ditolak",
  restricted: "Dibatasi",
  unsupported: "Tidak tersedia",
};

function normalize(value: string | undefined): PermState {
  switch (value) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "limited":
    case "restricted":
      return "restricted";
    case "prompt":
    case "prompt-with-rationale":
    case "default":
      return "prompt";
    default:
      return "unsupported";
  }
}

async function webQuery(name: PermissionName): Promise<PermState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name });
    return normalize(status.state);
  } catch {
    return "unsupported";
  }
}

export async function checkPermission(key: PermKey): Promise<PermState> {
  if (typeof window === "undefined") return "unsupported";

  if (isNative()) {
    if (key === "notifications") {
      // Sumber kebenaran: plugin native MCM (POST_NOTIFICATIONS Android 13+).
      const caps = await pushCapabilities();
      if (!caps) return "unsupported";
      return caps.permissionGranted ? "granted" : "prompt";
    }
  }

  switch (key) {
    case "notifications":
      return typeof Notification === "undefined"
        ? "unsupported"
        : normalize(Notification.permission);
    case "camera":
    case "microphone": {
      if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
      const state = await webQuery(key as PermissionName);
      // Some WebViews support capture but not the Permissions API. Keep the
      // explicit request action available instead of marking capture unavailable.
      return state === "unsupported" ? "prompt" : state;
    }
    case "location": {
      if (!navigator.geolocation?.getCurrentPosition) return "unsupported";
      const state = await webQuery("geolocation" as PermissionName);
      return state === "unsupported" ? "prompt" : state;
    }
    case "photos":
      return "unsupported";
  }
}

/** Minta izin sesuai fitur; hanya dipanggil dari aksi eksplisit pengguna. */
export async function requestPermission(key: PermKey): Promise<PermState> {
  if (typeof window === "undefined") return "unsupported";

  if (isNative()) {
    if (key === "notifications") {
      // Dialog POST_NOTIFICATIONS Android 13+ lewat plugin native MCM.
      return (await requestNativeNotificationPermission()) ? "granted" : "denied";
    }
  }

  if (key === "notifications" && typeof Notification !== "undefined") {
    return normalize(await Notification.requestPermission());
  }
  if (key === "camera" || key === "microphone") {
    if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        key === "camera" ? { video: true } : { audio: true },
      );
      stream.getTracks().forEach((t) => t.stop());
      return "granted";
    } catch (error) {
      // Missing/busy hardware is not a refused permission.
      return error instanceof Error && ["NotAllowedError", "SecurityError"].includes(error.name)
        ? "denied"
        : "unsupported";
    }
  }
  if (key === "location") {
    if (!navigator.geolocation?.getCurrentPosition) return "unsupported";
    return await new Promise<PermState>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve("granted"),
        (error) => resolve(error.code === 1 ? "denied" : "unsupported"),
        { timeout: 8000 },
      );
    });
  }
  return "unsupported";
}

/** Buka halaman pengaturan aplikasi bila izin sudah ditolak permanen. */
export async function openAppSettings(): Promise<boolean> {
  return (await openNativeAppSettings()).opened;
}
