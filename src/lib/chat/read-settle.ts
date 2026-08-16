/**
 * Penandaan "sudah dibaca" berbasis perilaku baca, bukan sekadar membuka ruang.
 *
 * Dua pemicu:
 * 1. Pengguna berhenti menggulir (settle) — semua pesan yang terlihat di
 *    viewport saat itu dianggap terbaca.
 * 2. Pengguna melompat ke pesan pertama belum dibaca — setelah sorotan selesai,
 *    seluruh blok belum dibaca dianggap terbaca.
 *
 * Semua fungsi murni agar bisa diuji tanpa DOM.
 */

/** Jeda diam sebelum area yang terlihat dihitung sebagai "sudah dibaca". */
export const READ_SETTLE_MS = 1200;

export type VisibleItem = { index: number; start: number; size: number };

/**
 * Indeks baris terakhir yang benar-benar terlihat penuh atau sebagian besar
 * (minimal setengah tingginya) di dalam viewport.
 */
export function lastVisibleIndex(
  items: readonly VisibleItem[],
  scrollTop: number,
  clientHeight: number,
): number {
  const bottom = scrollTop + clientHeight;
  let last = -1;
  for (const it of items) {
    const visible = Math.min(it.start + it.size, bottom) - Math.max(it.start, scrollTop);
    if (visible >= Math.min(it.size, 1) / 2 && visible > 0 && it.index > last) last = it.index;
  }
  return last;
}

/** Ambil timestamp terbaru di antara dua baseline (null = belum pernah baca). */
export function advanceReadBaseline(
  current: string | null,
  candidate: string | null,
): string | null {
  if (!candidate) return current;
  const c = new Date(candidate).getTime();
  if (Number.isNaN(c)) return current;
  if (!current) return candidate;
  const cur = new Date(current).getTime();
  if (Number.isNaN(cur) || c > cur) return candidate;
  return current;
}

/**
 * Baseline baru setelah pengguna berhenti membaca: waktu pesan terakhir yang
 * terlihat. Mengembalikan `current` bila tidak ada yang maju.
 */
export function settledBaseline(
  messages: readonly { created_at: string }[],
  lastIndex: number,
  current: string | null,
): string | null {
  if (lastIndex < 0) return current;
  const m = messages[Math.min(lastIndex, messages.length - 1)];
  return advanceReadBaseline(current, m?.created_at ?? null);
}
