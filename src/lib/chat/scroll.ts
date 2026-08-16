/** Jarak (px) dari dasar daftar yang masih dianggap "sedang membaca pesan terbaru". */
export const BOTTOM_THRESHOLD_PX = 120;

export function isNearBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
}

/** Jeda (ms) setelah sentuhan/gulir terakhir yang dianggap "pengguna masih menggulir". */
export const USER_SCROLL_GRACE_MS = 900;

/**
 * Keputusan auto-scroll: hanya turun otomatis bila pengguna memang berada di
 * dekat dasar, atau pesan terbaru dikirim oleh pengguna sendiri. Saat sedang
 * membaca riwayat lama, posisi dipertahankan dan indikator ditampilkan.
 *
 * `userScrolling` mencegah lompatan saat jari/momentum masih bergerak: daftar
 * tidak pernah direbut dari pengguna, kecuali pesan terakhir memang miliknya.
 */
export function shouldAutoScroll(opts: {
  atBottom: boolean;
  lastSenderId?: string | null;
  userId?: string | null | undefined;
  userScrolling?: boolean | undefined;
  /** Kunci manual: pengguna memilih tidak diseret ke pesan terbaru sama sekali. */
  locked?: boolean | undefined;
}): boolean {
  if (opts.locked) return false;
  const own = !!opts.userId && opts.lastSenderId === opts.userId;
  if (own) return true;
  if (opts.userScrolling) return false;
  return opts.atBottom;
}

/** True bila sentuhan/gulir terakhir masih dalam masa tenggang. */
export function isUserScrolling(lastInteractionAt: number, now = Date.now()): boolean {
  return now - lastInteractionAt < USER_SCROLL_GRACE_MS;
}
