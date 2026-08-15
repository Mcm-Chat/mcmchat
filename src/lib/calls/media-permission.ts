/**
 * Pemeriksaan & permintaan izin mikrofon/kamera sebelum panggilan dijawab.
 *
 * Menjawab panggilan tanpa izin media selalu berakhir dengan layar gagal:
 * `answer_call` sukses di server, lalu `getUserMedia` melempar NotAllowedError
 * dan pemanggil hanya mendengar sunyi. Karena itu tombol "Jawab" baru aktif
 * setelah izin benar-benar ada, dan penolakan izin punya jalan keluar yang
 * jelas (buka pengaturan / tolak panggilan) — bukan tombol mati tanpa alasan.
 */

export type MediaPermissionKind = "audio" | "video";

/** Error khusus izin media agar pesannya tampil apa adanya di layar panggilan. */
export class MediaPermissionError extends Error {
  readonly state: MediaPermissionState;
  constructor(state: MediaPermissionState, message: string) {
    super(message);
    this.name = "MediaPermissionError";
    this.state = state;
  }
}

export type MediaPermissionState =
  /** Belum diperiksa. */
  | "checking"
  /** Izin ada; panggilan boleh dijawab. */
  | "granted"
  /**
   * Mikrofon ada, kamera tidak (ditolak/tidak ada/dipakai aplikasi lain).
   * Panggilan video tetap boleh dijawab sebagai panggilan suara saja dan
   * kamera dibiarkan nonaktif.
   */
  | "audio_only"
  /** Belum diberikan; perlu satu tap "Izinkan". */
  | "prompt"
  /** Ditolak pengguna/OS; harus diubah lewat pengaturan. */
  | "denied"
  /** Perangkat mic/kamera tidak ada. */
  | "missing"
  /** Perangkat dipakai aplikasi lain. */
  | "busy"
  /** Browser/WebView tidak menyediakan media sama sekali. */
  | "unsupported";

/** Panggilan video butuh mic + kamera; panggilan suara cukup mic. */
export function requiredPermissions(kind: MediaPermissionKind): Array<"microphone" | "camera"> {
  return kind === "video" ? ["microphone", "camera"] : ["microphone"];
}

function mediaDevices(): MediaDevices | null {
  if (typeof navigator === "undefined") return null;
  return navigator.mediaDevices ?? null;
}

/** Klasifikasi error getUserMedia menjadi status yang bisa ditindaklanjuti. */
export function classifyMediaError(e: unknown): MediaPermissionState {
  const name = (e as { name?: string } | null)?.name ?? "";
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied|izin/.test(msg))
    return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || /notfound/.test(msg))
    return "missing";
  if (name === "NotReadableError" || name === "AbortError" || /in use|readable/.test(msg))
    return "busy";
  return "denied";
}

/**
 * Baca status izin tanpa memicu dialog. Permissions API tidak tersedia di semua
 * WebView; saat itu terjadi kita kembalikan "prompt" (aman: pengguna diminta).
 */
export async function queryMediaPermission(
  kind: MediaPermissionKind,
): Promise<MediaPermissionState> {
  if (!mediaDevices()?.getUserMedia) return "unsupported";
  const perms = typeof navigator !== "undefined" ? navigator.permissions : undefined;
  if (!perms?.query) return "prompt";
  const names = requiredPermissions(kind);
  const states: PermissionState[] = [];
  const byName: Partial<Record<"microphone" | "camera", PermissionState>> = {};
  for (const name of names) {
    try {
      const status = await perms.query({ name: name as PermissionName });
      states.push(status.state);
      byName[name] = status.state;
    } catch {
      return "prompt";
    }
  }
  // Panggilan video dengan kamera ditolak tetapi mikrofon siap tetap bisa
  // dijawab sebagai panggilan suara saja.
  if (kind === "video" && byName.camera === "denied" && byName.microphone === "granted")
    return "audio_only";
  if (states.includes("denied")) return "denied";
  return states.every((s) => s === "granted") ? "granted" : "prompt";
}

/** Cek cepat apakah mikrofon saja bisa dibuka (tanpa menyalakan kamera). */
async function micUsable(): Promise<boolean> {
  const md = mediaDevices();
  if (!md?.getUserMedia) return false;
  try {
    const stream = await md.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Minta izin secara eksplisit. Stream langsung ditutup: tujuannya hanya
 * memastikan izin, media panggilan dibuka ulang oleh sesi LiveKit.
 */
export async function requestMediaPermission(
  kind: MediaPermissionKind,
): Promise<MediaPermissionState> {
  const md = mediaDevices();
  if (!md?.getUserMedia) return "unsupported";
  try {
    const stream = await md.getUserMedia({ audio: true, video: kind === "video" });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (e) {
    const state = classifyMediaError(e);
    // Kamera bermasalah pada panggilan video tidak boleh mematikan panggilan
    // suaranya: bila mikrofon saja masih bisa dibuka, panggilan dijawab
    // sebagai suara dan kamera tetap nonaktif.
    if (kind === "video" && (await micUsable())) return "audio_only";
    return state;
  }
}

export type MediaPermissionCopy = {
  /** Ringkas, tampil di atas tombol. */
  title: string;
  /** Cara memperbaiki. */
  help: string;
  /** Label tombol aksi utama, null bila tidak ada yang bisa dicoba. */
  action: string | null;
};

/** Teks Bahasa Indonesia yang jujur untuk tiap status izin. */
export function mediaPermissionCopy(
  state: MediaPermissionState,
  kind: MediaPermissionKind,
): MediaPermissionCopy {
  const what = kind === "video" ? "mikrofon dan kamera" : "mikrofon";
  switch (state) {
    case "granted":
      return { title: `Izin ${what} aktif`, help: "", action: null };
    case "audio_only":
      return {
        title: "Kamera nonaktif — panggilan suara saja",
        help: "Izin kamera tidak tersedia. Panggilan bisa dijawab memakai mikrofon saja; kamera tetap mati. Aktifkan izin kamera di pengaturan lalu ketuk Periksa lagi bila ingin video.",
        action: "Periksa lagi",
      };
    case "checking":
      return { title: "Memeriksa izin…", help: "", action: null };
    case "prompt":
      return {
        title: `Butuh izin ${what}`,
        help: `Ketuk "Izinkan ${what}" lalu pilih Izinkan pada permintaan sistem agar panggilan bisa dijawab.`,
        action: `Izinkan ${what}`,
      };
    case "denied":
      return {
        title: `Izin ${what} ditolak`,
        help: `Buka Pengaturan aplikasi/situs → Izin → aktifkan ${what}, lalu ketuk Periksa lagi. Sementara itu panggilan hanya bisa ditolak.`,
        action: "Periksa lagi",
      };
    case "missing":
      return {
        title: `Perangkat ${what} tidak ditemukan`,
        help: "Sambungkan headset atau perangkat mikrofon, lalu ketuk Periksa lagi.",
        action: "Periksa lagi",
      };
    case "busy":
      return {
        title: `${what[0]?.toUpperCase()}${what.slice(1)} sedang dipakai aplikasi lain`,
        help: "Tutup aplikasi panggilan/perekam lain, lalu ketuk Periksa lagi.",
        action: "Periksa lagi",
      };
    case "unsupported":
    default:
      return {
        title: "Perangkat ini tidak mendukung panggilan",
        help: "Buka MCM di aplikasi Android atau browser yang mendukung mikrofon.",
        action: null,
      };
  }
}

/** Status yang boleh mengaktifkan tombol Jawab (termasuk mode suara saja). */
export function canAnswer(state: MediaPermissionState): boolean {
  return state === "granted" || state === "audio_only";
}

/** True bila panggilan hanya boleh berjalan tanpa kamera. */
export function isAudioOnly(state: MediaPermissionState): boolean {
  return state === "audio_only";
}
