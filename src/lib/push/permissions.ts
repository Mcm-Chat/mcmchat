/**
 * Status izin runtime lintas platform (web preview + Android/Capacitor).
 * Prinsip least privilege: izin hanya diminta saat fitur dipakai, tidak ada
 * background location, tidak ada akses seluruh file, tidak ada exact alarm.
 */
import { isNative } from "./native";

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
    desc: "Memakai Photo Picker Android; MCM tidak meminta akses seluruh file.",
  },
};

export const STATE_LABEL: Record<PermState, string> = {
  granted: "Diizinkan",
  prompt: "Belum diminta",
  denied: "Ditolak",
  restricted: "Dibatasi",
  unsupported: "Tidak tersedia",
};

async function plugin(name: string): Promise<Record<string, unknown> | null> {
  try {
    const mod = (await import(/* @vite-ignore */ name)) as Record<string, unknown>;
    const key = Object.keys(mod).find((k) => k !== "default");
    return key ? (mod[key] as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

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
      const push = await plugin("@capacitor/push-notifications");
      const check = push?.["checkPermissions"] as (() => Promise<{ receive: string }>) | undefined;
      return check ? normalize((await check()).receive) : "unsupported";
    }
    if (key === "camera" || key === "photos") {
      const cam = await plugin("@capacitor/camera");
      const check = cam?.["checkPermissions"] as
        (() => Promise<{ camera: string; photos: string }>) | undefined;
      if (!check) return "unsupported";
      const res = await check();
      return normalize(key === "camera" ? res.camera : res.photos);
    }
    if (key === "location") {
      const geo = await plugin("@capacitor/geolocation");
      const check = geo?.["checkPermissions"] as (() => Promise<{ location: string }>) | undefined;
      return check ? normalize((await check()).location) : "unsupported";
    }
  }

  switch (key) {
    case "notifications":
      return typeof Notification === "undefined"
        ? "unsupported"
        : normalize(Notification.permission);
    case "camera":
      return webQuery("camera" as PermissionName);
    case "microphone":
      return webQuery("microphone" as PermissionName);
    case "location":
      return webQuery("geolocation" as PermissionName);
    case "photos":
      return "unsupported";
  }
}

/** Minta izin sesuai fitur; hanya dipanggil dari aksi eksplisit pengguna. */
export async function requestPermission(key: PermKey): Promise<PermState> {
  if (typeof window === "undefined") return "unsupported";

  if (isNative()) {
    if (key === "notifications") {
      const push = await plugin("@capacitor/push-notifications");
      const req = push?.["requestPermissions"] as (() => Promise<{ receive: string }>) | undefined;
      return req ? normalize((await req()).receive) : "unsupported";
    }
    if (key === "camera" || key === "photos") {
      const cam = await plugin("@capacitor/camera");
      const req = cam?.["requestPermissions"] as
        ((o: unknown) => Promise<{ camera: string; photos: string }>) | undefined;
      if (!req) return "unsupported";
      const res = await req({ permissions: [key] });
      return normalize(key === "camera" ? res.camera : res.photos);
    }
    if (key === "location") {
      const geo = await plugin("@capacitor/geolocation");
      const req = geo?.["requestPermissions"] as
        ((o: unknown) => Promise<{ location: string }>) | undefined;
      // Hanya izin saat aplikasi dipakai — tidak pernah background location.
      return req ? normalize((await req({ permissions: ["location"] })).location) : "unsupported";
    }
  }

  if (key === "notifications" && typeof Notification !== "undefined") {
    return normalize(await Notification.requestPermission());
  }
  if (key === "camera" || key === "microphone") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        key === "camera" ? { video: true } : { audio: true },
      );
      stream.getTracks().forEach((t) => t.stop());
      return "granted";
    } catch {
      return "denied";
    }
  }
  if (key === "location") {
    return await new Promise<PermState>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve("granted"),
        () => resolve("denied"),
        { timeout: 8000 },
      );
    });
  }
  return "unsupported";
}

/** Buka halaman pengaturan aplikasi bila izin sudah ditolak permanen. */
export async function openAppSettings(): Promise<boolean> {
  const app = await plugin("@capacitor/app");
  const open = app?.["openSettings"] as (() => Promise<void>) | undefined;
  if (open) {
    await open();
    return true;
  }
  const native = await plugin("capacitor-native-settings");
  const openNative = native?.["openAndroid"] as ((o: unknown) => Promise<void>) | undefined;
  if (openNative) {
    await openNative({ option: "application_details" });
    return true;
  }
  return false;
}
