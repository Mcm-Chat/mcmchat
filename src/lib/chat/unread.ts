/**
 * Perhitungan "pesan belum dibaca" untuk satu ruang chat.
 *
 * Baseline `last_read_at` diambil sekali saat ruang dibuka (sebelum server
 * menandai dibaca), sehingga penanda pertama-belum-dibaca tetap stabil.
 */
export type UnreadInput = {
  id: string;
  sender_id: string | null;
  created_at: string;
  kind?: string | null;
};

export type UnreadSummary = {
  /** Indeks pesan pertama yang belum dibaca (-1 bila tidak ada). */
  firstIndex: number;
  /** Jumlah pesan masuk yang belum dibaca dalam daftar termuat. */
  count: number;
  /** Id pesan pertama yang belum dibaca. */
  firstId: string | null;
};

export function summarizeUnread(
  messages: readonly UnreadInput[],
  userId: string | null,
  lastReadAt: string | null,
): UnreadSummary {
  const empty: UnreadSummary = { firstIndex: -1, count: 0, firstId: null };
  if (!userId || messages.length === 0) return empty;
  const baseline = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  if (Number.isNaN(baseline)) return empty;
  let firstIndex = -1;
  let count = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.sender_id === userId) continue;
    if (m.kind === "system") continue;
    const t = new Date(m.created_at).getTime();
    if (Number.isNaN(t) || t <= baseline) continue;
    if (firstIndex < 0) firstIndex = i;
    count++;
  }
  return { firstIndex, count, firstId: firstIndex >= 0 ? messages[firstIndex]!.id : null };
}
