/**
 * Pemulihan media saat penyedia (LiveKit) sudah tersambung tetapi media tidak
 * pernah benar-benar mulai.
 *
 * Gejala nyatanya: room berstatus connected, tapi track mikrofon lokal mati
 * (izin dicabut di tengah jalan, mic direbut aplikasi lain, WebView menahan
 * getUserMedia). Tanpa pemulihan, kedua pihak melihat "terhubung" sambil
 * saling diam. Kebijakan di modul ini murni supaya bisa diuji.
 */

export type MediaRecoveryAction =
  /** Ambil ulang mikrofon lalu ganti track keluar. */
  | "retry-mic"
  /** Turunkan ke panggilan suara saja (matikan kamera) lalu coba mic lagi. */
  | "downgrade-audio"
  /** Sudah tidak ada yang bisa dicoba otomatis; beri tahu pengguna. */
  | "give-up";

export type MediaRecoveryPlan = { action: MediaRecoveryAction; message: string };

/** Jeda sebelum media dianggap gagal mulai setelah room tersambung. */
export const MEDIA_START_GRACE_MS = 4000;
/** Jeda antar percobaan pemulihan. */
export const MEDIA_RETRY_DELAY_MS = 3000;
/** Jumlah maksimum percobaan otomatis. */
export const MAX_MEDIA_RECOVERIES = 3;

/**
 * Rencana untuk ronde ke-`round` (mulai dari 1).
 * Panggilan video menurunkan diri ke suara saja pada ronde kedua: kamera
 * adalah penyebab kegagalan getUserMedia yang paling sering di ponsel murah.
 */
export function planMediaRecovery(round: number, kind: "audio" | "video"): MediaRecoveryPlan {
  if (round > MAX_MEDIA_RECOVERIES)
    return {
      action: "give-up",
      message:
        "Mikrofon tidak bisa dimulai. Tutup aplikasi lain yang memakai mikrofon atau akhiri lalu ulangi panggilan.",
    };
  if (round === 2 && kind === "video")
    return {
      action: "downgrade-audio",
      message: "Kamera dimatikan — mencoba melanjutkan sebagai panggilan suara…",
    };
  return { action: "retry-mic", message: "Media belum mulai — mencoba mikrofon lagi…" };
}

/** True bila stream mikrofon punya minimal satu track yang benar-benar hidup. */
export function hasLiveAudio(stream: MediaStream | null): boolean {
  return (stream?.getAudioTracks() ?? []).some((t) => t.readyState === "live" && !t.muted);
}
