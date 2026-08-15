/**
 * Ringkasan status koneksi panggilan untuk ditampilkan (bukan hanya dibacakan).
 *
 * Pengguna sering menyentuh tombol mikrofon/kamera saat panggilan belum benar
 * tersambung lalu menyimpulkan aplikasinya rusak. Chip status ini menyatakan
 * kondisi koneksi apa adanya dan, bila kontrol memang belum bisa dipakai,
 * menyebut alasannya dalam satu kalimat pendek.
 */
import type { MediaPermissionState } from "./media-permission";

export type CallConnectionTone = "live" | "pending" | "warn" | "down";

export type CallConnectionInput = {
  phase: string;
  retrying?: boolean;
  quality?: "good" | "fair" | "poor" | "unknown" | undefined;
  audioBlocked?: boolean;
  permission?: MediaPermissionState | undefined;
};

export type CallConnectionStatus = {
  tone: CallConnectionTone;
  label: string;
  /** Alasan kontrol mungkin belum berfungsi; null bila semuanya normal. */
  hint: string | null;
};

function permissionHint(state: MediaPermissionState | undefined): string | null {
  switch (state) {
    case "checking":
      return "Memeriksa izin mikrofon/kamera…";
    case "prompt":
      return "Sentuh kontrol untuk memberi izin mikrofon/kamera.";
    case "denied":
      return "Izin ditolak — ubah di pengaturan lalu coba lagi.";
    case "audio_only":
      return "Kamera tidak diizinkan — panggilan berjalan sebagai suara.";
    case "missing":
      return "Perangkat mikrofon/kamera tidak terdeteksi.";
    case "busy":
      return "Mikrofon/kamera sedang dipakai aplikasi lain.";
    case "unsupported":
      return "Perangkat ini tidak mendukung media panggilan.";
    default:
      return null;
  }
}

export function callConnectionStatus(input: CallConnectionInput): CallConnectionStatus {
  const perm = permissionHint(input.permission);

  if (input.phase === "error")
    return { tone: "down", label: "Terputus", hint: "Sambungan gagal — coba sambungkan ulang." };
  if (input.phase === "unconfigured")
    return { tone: "down", label: "Belum siap", hint: "Layanan panggilan belum terhubung." };
  if (input.phase === "ended") return { tone: "down", label: "Panggilan selesai", hint: null };
  if (input.retrying || input.phase === "connecting")
    return {
      tone: "pending",
      label: input.retrying ? "Mencoba menyambungkan ulang…" : "Menyambungkan…",
      hint: "Kontrol aktif setelah panggilan tersambung.",
    };
  if (input.phase === "outgoing") return { tone: "pending", label: "Menunggu dijawab…", hint: perm };
  if (input.phase === "incoming")
    return { tone: "pending", label: "Panggilan masuk", hint: perm ?? "Tekan Jawab untuk mulai." };
  if (input.phase === "loading") return { tone: "pending", label: "Menyiapkan…", hint: null };

  // phase === "connected"
  if (input.audioBlocked)
    return {
      tone: "warn",
      label: "Terhubung — suara diblokir",
      hint: "Tekan “Aktifkan suara” agar bisa mendengar.",
    };
  if (input.quality === "poor")
    return { tone: "warn", label: "Terhubung — sinyal lemah", hint: perm };
  if (input.quality === "fair")
    return { tone: "live", label: "Terhubung — sinyal sedang", hint: perm };
  return { tone: "live", label: "Terhubung", hint: perm };
}
