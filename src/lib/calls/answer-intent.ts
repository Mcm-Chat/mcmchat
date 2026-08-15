/**
 * Niat "jawab panggilan" yang dibawa antar-layar.
 *
 * Banner panggilan masuk hanya bisa bernavigasi ke `/call/$id`; tanpa penanda
 * ini pengguna harus menekan "Jawab" dua kali dan sering kehabisan batas dering
 * 45 detik. Penanda disimpan di memori modul (bukan storage) supaya tidak bocor
 * antar-akun dan otomatis hilang saat aplikasi ditutup.
 */
let pending: { callId: string; at: number } | null = null;

/** Berlaku singkat: niat basi tidak boleh menjawab panggilan lain. */
const TTL_MS = 60_000;

export function markAnswerIntent(callId: string) {
  pending = { callId, at: Date.now() };
}

/** Ambil sekali pakai. Mengembalikan true bila layar ini memang harus menjawab. */
export function consumeAnswerIntent(callId: string): boolean {
  if (!pending) return false;
  const ok = pending.callId === callId && Date.now() - pending.at <= TTL_MS;
  pending = null;
  return ok;
}

export function clearAnswerIntent() {
  pending = null;
}
