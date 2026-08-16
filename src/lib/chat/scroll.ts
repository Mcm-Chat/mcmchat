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

/**
 * Kompensasi scroll saat tinggi visual viewport berubah (keyboard muncul /
 * hilang / berubah tinggi). Tujuannya: konten yang sedang dibaca tetap di
 * tempat, tidak "loncat".
 *
 * - `stick`: pengguna memang di pesan terbaru dan tidak mengunci scroll →
 *   tempelkan lagi ke dasar.
 * - `adjust`: geser scrollTop sebesar selisih tinggi viewport supaya baris
 *   yang sama tetap terlihat.
 * - `none`: perubahan terlalu kecil (mis. bar URL) → jangan sentuh scroll.
 */
export const VIEWPORT_DELTA_MIN_PX = 24;

export function keyboardScrollAction(opts: {
  prevHeight: number;
  nextHeight: number;
  atBottom: boolean;
  locked?: boolean | undefined;
}): { type: "stick" } | { type: "adjust"; delta: number } | { type: "none" } {
  const delta = opts.prevHeight - opts.nextHeight;
  if (opts.atBottom && !opts.locked) return { type: "stick" };
  if (Math.abs(delta) < VIEWPORT_DELTA_MIN_PX) return { type: "none" };
  return { type: "adjust", delta };
}

/**
 * Anchor baris untuk menjaga posisi baca saat tinggi baris berubah (gambar
 * selesai dimuat, kartu balasan terbuka, emoji besar, dsb).
 */
export type ScrollAnchor = { index: number; start: number };

/** Baris pertama yang masih terlihat di viewport — dipakai sebagai jangkar. */
export function pickScrollAnchor(
  items: readonly { index: number; start: number; end: number }[],
  scrollTop: number,
): ScrollAnchor | null {
  for (const it of items) {
    if (it.end > scrollTop) return { index: it.index, start: it.start };
  }
  const last = items.at(-1);
  return last ? { index: last.index, start: last.start } : null;
}

/** Selisih px yang perlu ditambahkan ke scrollTop agar jangkar tetap di tempat. */
export function anchorScrollDelta(anchor: ScrollAnchor, nextStart: number | undefined): number {
  if (nextStart === undefined || !Number.isFinite(nextStart)) return 0;
  const delta = nextStart - anchor.start;
  return Math.abs(delta) < 1 ? 0 : delta;
}
