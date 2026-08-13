/** Jarak (px) dari dasar daftar yang masih dianggap "sedang membaca pesan terbaru". */
export const BOTTOM_THRESHOLD_PX = 120;

export function isNearBottom(el: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
}

/**
 * Keputusan auto-scroll: hanya turun otomatis bila pengguna memang berada di
 * dekat dasar, atau pesan terbaru dikirim oleh pengguna sendiri. Saat sedang
 * membaca riwayat lama, posisi dipertahankan dan indikator ditampilkan.
 */
export function shouldAutoScroll(opts: {
  atBottom: boolean;
  lastSenderId?: string | null;
  userId?: string | null | undefined;
}): boolean {
  if (opts.atBottom) return true;
  return !!opts.userId && opts.lastSenderId === opts.userId;
}
