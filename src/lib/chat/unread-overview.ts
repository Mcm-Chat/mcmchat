/**
 * Ringkasan unread lintas percakapan untuk daftar chat utama.
 * Murni agar bisa diuji tanpa React.
 */
export type UnreadConv = {
  id: string;
  title_resolved: string;
  unread: number;
  is_group?: boolean;
  last_message_at?: string | null;
};

export type UnreadOverview = {
  /** Total pesan belum dibaca di semua percakapan aktif. */
  total: number;
  /** Jumlah percakapan yang punya pesan belum dibaca. */
  rooms: number;
  /** Percakapan dengan unread terbanyak (tiebreak: paling baru). */
  top: UnreadConv | null;
};

export function overviewUnread(convs: readonly UnreadConv[]): UnreadOverview {
  let total = 0;
  let rooms = 0;
  let top: UnreadConv | null = null;
  for (const c of convs) {
    const n = c.unread ?? 0;
    if (n <= 0) continue;
    total += n;
    rooms++;
    if (!top) {
      top = c;
      continue;
    }
    if (n > top.unread) top = c;
    else if (n === top.unread) {
      const a = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      const b = top.last_message_at ? new Date(top.last_message_at).getTime() : 0;
      if (a > b) top = c;
    }
  }
  return { total, rooms, top };
}
