/**
 * Helper diagnostik panggilan (murni + pemeriksaan browser).
 *
 * Tidak pernah menyentuh nilai secret: konfigurasi hanya dilaporkan sebagai
 * "terisi / belum terisi" oleh server function `getCallConfig`.
 */
export type CheckStatus = "pass" | "fail" | "warn" | "pending";

export type DiagnosticResult = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Tindakan yang harus dilakukan bila gagal. */
  action?: string;
};

export const result = (
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  action?: string,
): DiagnosticResult => ({ id, label, status, detail, ...(action ? { action } : {}) });

/** Ringkasan keseluruhan: gagal > peringatan > menunggu > lulus. */
export function overallStatus(results: DiagnosticResult[]): CheckStatus {
  if (results.some((r) => r.status === "fail")) return "fail";
  if (results.some((r) => r.status === "warn")) return "warn";
  if (results.some((r) => r.status === "pending")) return "pending";
  return "pass";
}

export const PROVIDER_CODE_DETAIL: Record<string, { detail: string; action: string }> = {
  provider_unconfigured: {
    detail: "Kredensial panggilan belum terisi di server.",
    action: "Pemilik aplikasi mengisi LIVEKIT_URL, LIVEKIT_API_KEY, dan LIVEKIT_API_SECRET.",
  },
  provider_url_invalid: {
    detail: "LIVEKIT_URL tidak valid (harus diawali wss://).",
    action: "Perbaiki LIVEKIT_URL menjadi wss://<subdomain>.livekit.cloud.",
  },
};

export function providerCheck(configured: boolean, code = "provider_unconfigured"): DiagnosticResult {
  if (configured)
    return result("provider", "Konfigurasi penyedia", "pass", "Kredensial panggilan sudah terisi.");
  const info = PROVIDER_CODE_DETAIL[code] ?? PROVIDER_CODE_DETAIL["provider_unconfigured"]!;
  return result("provider", "Konfigurasi penyedia", "fail", `${info.detail} (${code})`, info.action);
}

export function secureContextCheck(secure: boolean, host: string): DiagnosticResult {
  const localhost = host === "localhost" || host === "127.0.0.1";
  return secure || localhost
    ? result("secure", "Koneksi aman (HTTPS)", "pass", `Konteks aman aktif di ${host}.`)
    : result(
        "secure",
        "Koneksi aman (HTTPS)",
        "fail",
        "Halaman tidak berjalan pada konteks aman.",
        "Buka aplikasi lewat HTTPS; mikrofon dan kamera diblokir di HTTP.",
      );
}

export function mediaDevicesCheck(supported: boolean): DiagnosticResult {
  return supported
    ? result("media", "Dukungan perangkat media", "pass", "Browser mendukung mikrofon dan kamera.")
    : result(
        "media",
        "Dukungan perangkat media",
        "fail",
        "Browser tidak menyediakan mediaDevices.",
        "Perbarui browser atau gunakan aplikasi Android MCM.",
      );
}

export function permissionCheck(
  id: "mic" | "camera",
  state: PermissionState | "unsupported",
): DiagnosticResult {
  const label = id === "mic" ? "Izin mikrofon" : "Izin kamera";
  if (state === "granted") return result(id, label, "pass", "Izin sudah diberikan.");
  if (state === "denied")
    return result(
      id,
      label,
      "fail",
      "Izin ditolak.",
      "Buka pengaturan situs/aplikasi dan izinkan akses, lalu muat ulang.",
    );
  if (state === "prompt")
    return result(id, label, "warn", "Izin akan diminta saat panggilan pertama dimulai.");
  return result(id, label, "warn", "Browser tidak melaporkan status izin; tes perangkat langsung.");
}

/** Pemetaan error perangkat menjadi pesan Bahasa Indonesia + kode teknis aman. */
export function deviceErrorMessage(name: string): { code: string; message: string } {
  switch (name) {
    case "NotAllowedError":
      return { code: "device_denied", message: "Akses ditolak oleh pengguna atau sistem." };
    case "NotFoundError":
      return { code: "device_missing", message: "Perangkat mikrofon/kamera tidak ditemukan." };
    case "NotReadableError":
      return { code: "device_busy", message: "Perangkat sedang dipakai aplikasi lain." };
    case "OverconstrainedError":
      return { code: "device_constraints", message: "Perangkat tidak memenuhi kualitas diminta." };
    default:
      return { code: "device_error", message: "Perangkat gagal dibuka." };
  }
}

export async function readPermission(name: "microphone" | "camera") {
  if (typeof navigator === "undefined" || !navigator.permissions) return "unsupported" as const;
  try {
    const s = await navigator.permissions.query({ name: name as PermissionName });
    return s.state;
  } catch {
    return "unsupported" as const;
  }
}

/** Tes perangkat lokal nyata: buka lalu segera tutup track. */
export async function testLocalDevices(video: boolean): Promise<DiagnosticResult> {
  const label = video ? "Tes mikrofon + kamera" : "Tes mikrofon";
  if (typeof navigator === "undefined" || !navigator.mediaDevices)
    return result("device-test", label, "fail", "mediaDevices tidak tersedia.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    const tracks = stream.getTracks();
    const names = tracks.map((t) => t.kind).join(", ");
    tracks.forEach((t) => t.stop());
    return result("device-test", label, "pass", `Perangkat terbuka: ${names}.`);
  } catch (e) {
    const { code, message } = deviceErrorMessage(e instanceof Error ? e.name : "");
    return result("device-test", label, "fail", `${message} (${code})`, "Periksa izin perangkat.");
  }
}

export type DiagnosticTokenResult =
  | { ok: true; url: string; token: string; room: string; expiresInSec: number }
  | { ok: false; code: string };

/**
 * Tes koneksi end-to-end ke LiveKit memakai token diagnostik sekali pakai
 * (observer, TTL <= 60 detik). Token dibuang setelah tes; tidak ada media,
 * tidak ada data, dan tidak ada baris panggilan yang tersentuh.
 */
export async function runLiveKitConnectTest(
  issueToken: () => Promise<DiagnosticTokenResult>,
): Promise<DiagnosticResult> {
  const label = "Tes koneksi LiveKit";
  let t: DiagnosticTokenResult;
  try {
    t = await issueToken();
  } catch {
    return result("livekit", label, "fail", "Server tidak dapat dihubungi. (server_unreachable)", "Periksa koneksi internet lalu coba lagi.");
  }
  if (!t.ok) {
    const info = PROVIDER_CODE_DETAIL[t.code];
    return result(
      "livekit",
      label,
      "fail",
      `${info?.detail ?? "Tes tidak dapat dijalankan."} (${t.code})`,
      info?.action ?? "Hubungi pemilik aplikasi.",
    );
  }
  const started = Date.now();
  const { Room } = await import("livekit-client");
  const room = new Room();
  try {
    await room.connect(t.url, t.token, { autoSubscribe: false });
    const ms = Date.now() - started;
    return result("livekit", label, "pass", `Tersambung ke server panggilan dalam ${ms} ms.`);
  } catch (e) {
    return result(
      "livekit",
      label,
      "fail",
      `Gagal menyambung ke server panggilan. (livekit_connect_failed: ${
        e instanceof Error ? e.name : "unknown"
      })`,
      "Periksa LIVEKIT_URL/kredensial dan pastikan jaringan tidak memblokir WebSocket.",
    );
  } finally {
    await room.disconnect().catch(() => undefined);
  }
}
