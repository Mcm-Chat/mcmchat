/**
 * Retry handshake panggilan (signalling + WebRTC).
 *
 * Jaringan seluler Indonesia sering gagal pada percobaan pertama: DNS lambat,
 * ICE tertahan, atau token sampai saat sel berpindah. Kegagalan seperti itu
 * bersifat sementara dan hampir selalu berhasil pada percobaan kedua, jadi
 * handshake diulang otomatis dengan jeda menaik sebelum layar gagal muncul.
 *
 * Yang TIDAK diulang: izin ditolak, perangkat sibuk, panggilan sudah berakhir,
 * dan penolakan otorisasi — mengulanginya hanya membuang waktu pengguna.
 */

export const HANDSHAKE_ATTEMPTS = 3;
/** Jeda dasar; percobaan ke-n menunggu base * 2^(n-1) + jitter. */
export const HANDSHAKE_BASE_DELAY_MS = 800;
/** Satu percobaan handshake tidak boleh menggantung tanpa batas. */
export const HANDSHAKE_TIMEOUT_MS = 20_000;

export class HandshakeTimeoutError extends Error {
  constructor() {
    super("Waktu menyambungkan panggilan habis (jaringan lambat)");
    this.name = "HandshakeTimeoutError";
  }
}

function text(e: unknown): string {
  return (e instanceof Error ? e.message : typeof e === "string" ? e : "").toLowerCase();
}

/** Kegagalan permanen: mengulang tidak akan menolong. */
export function isPermanentHandshakeError(e: unknown): boolean {
  const r = text(e);
  return (
    /notallowed|permission denied|izin|denied/.test(r) ||
    /notfound|notreadable|overconstrained|sedang dipakai/.test(r) ||
    /sudah berakhir|tidak ditemukan|bukan peserta|sudah keluar|tidak tersedia/.test(r) ||
    /belum terhubung|kredensial|unauthorized|forbidden/.test(r) ||
    /row-level security/.test(r)
  );
}

export function isTransientHandshakeError(e: unknown): boolean {
  return !isPermanentHandshakeError(e);
}

/** Jeda percobaan ke-`attempt` (1-based) dalam milidetik, dengan jitter kecil. */
export function handshakeDelayMs(attempt: number, random = Math.random): number {
  const base = HANDSHAKE_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.round(base + random() * 250);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Batasi satu percobaan handshake dengan tenggat waktu. */
export async function withHandshakeTimeout<T>(
  run: () => Promise<T>,
  timeoutMs = HANDSHAKE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HandshakeTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type HandshakeRetryOptions = {
  attempts?: number;
  timeoutMs?: number;
  /** Dipanggil sebelum tiap percobaan (1-based) untuk memperbarui pesan layar. */
  onAttempt?: (attempt: number, total: number) => void;
  /** Batalkan retry saat panggilan sudah berakhir/dibatalkan pengguna. */
  isAborted?: () => boolean;
  /** Bersih-bersih sebelum percobaan ulang (mis. lepas sesi setengah jadi). */
  onRetry?: (error: unknown, nextAttempt: number) => void | Promise<void>;
  sleepFn?: (ms: number) => Promise<void>;
  random?: () => number;
};

/**
 * Jalankan handshake dengan percobaan ulang berjeda menaik. Error permanen
 * langsung dilempar tanpa menunggu.
 */
export async function withHandshakeRetry<T>(
  run: (attempt: number) => Promise<T>,
  opts: HandshakeRetryOptions = {},
): Promise<T> {
  const total = opts.attempts ?? HANDSHAKE_ATTEMPTS;
  const wait = opts.sleepFn ?? sleep;
  let last: unknown = new Error("Handshake panggilan gagal");
  for (let attempt = 1; attempt <= total; attempt += 1) {
    if (opts.isAborted?.()) return Promise.reject(last);
    opts.onAttempt?.(attempt, total);
    try {
      return await withHandshakeTimeout(() => run(attempt), opts.timeoutMs);
    } catch (e) {
      last = e;
      if (attempt >= total || isPermanentHandshakeError(e) || opts.isAborted?.()) throw e;
      await opts.onRetry?.(e, attempt + 1);
      if (opts.isAborted?.()) throw e;
      await wait(handshakeDelayMs(attempt, opts.random));
    }
  }
  throw last;
}

/** Teks progres untuk layar/aria-live. */
export function handshakeProgressText(attempt: number, total: number): string {
  return attempt <= 1
    ? "Menyambungkan panggilan…"
    : `Koneksi awal bermasalah — mencoba lagi (${attempt} dari ${total})…`;
}
