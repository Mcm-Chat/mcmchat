/**
 * Watchdog tahap "Menyambungkan…".
 *
 * Handshake bisa "menggantung": token sudah terbit, provider tidak melempar
 * error, tetapi status `connected` tidak pernah datang (ICE tertahan, token
 * kedaluwarsa saat sel berpindah, kanal realtime mati). Tanpa batas waktu,
 * layar berhenti di "Menyambungkan…" selamanya; dengan layar error, pengguna
 * terlempar keluar dari panggilan yang sebenarnya masih bisa diselamatkan.
 *
 * Aturan: beri kabar saat lambat, lalu pulihkan sendiri (token baru +
 * re-subscribe) beberapa ronde, dan berhenti pada status "macet" yang tetap di
 * layar panggilan dengan tombol coba lagi — bukan layar error.
 */

/** Ambang "jaringan lambat": ubah teks, belum ada tindakan. */
export const CONNECT_SLOW_MS = 9_000;
/** Batas keras satu ronde penyambungan sebelum pemulihan dijalankan. */
export const CONNECT_TIMEOUT_MS = 22_000;
/** Jumlah pemulihan otomatis sebelum menyerah ke status "macet". */
export const CONNECT_MAX_RECOVERIES = 2;
/** Jeda sebelum ronde pemulihan berikutnya (memberi jaringan waktu pulih). */
export const CONNECT_RECOVERY_DELAY_MS = 1_200;

export type ConnectStage = "slow" | "recovering" | "stalled";

/** Batas waktu ronde ke-`round` (0 = ronde pertama), naik bertahap. */
export function connectTimeoutMs(round: number): number {
  return CONNECT_TIMEOUT_MS + Math.max(0, round) * 5_000;
}

/** Masih boleh memulihkan otomatis? */
export function canAutoRecover(round: number, max = CONNECT_MAX_RECOVERIES): boolean {
  return round < max;
}

/** Teks progres berbahasa manusia untuk layar dan `aria-live`. */
export function connectStageMessage(
  stage: ConnectStage,
  round = 0,
  max = CONNECT_MAX_RECOVERIES,
): string {
  switch (stage) {
    case "slow":
      return "Jaringan lambat — masih menyambungkan panggilan…";
    case "recovering":
      return `Sambungan tertahan — menyegarkan koneksi (${Math.min(round, max)} dari ${max})…`;
    case "stalled":
      return "Sambungan belum berhasil. Panggilan tetap terbuka — tekan “Coba lagi” atau tutup panggilan.";
  }
}
