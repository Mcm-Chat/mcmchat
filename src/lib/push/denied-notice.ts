/**
 * Kanal pemberitahuan "akses notifikasi ditolak".
 *
 * Guard rute push berjalan di luar React (listener service worker / native),
 * jadi hasilnya dipublikasikan lewat emitter kecil ini dan dirender oleh
 * `<PushDeniedDialog />` di root. Toast dipakai sebagai lapisan cepat, modal
 * untuk alasan yang butuh penjelasan (dikeluarkan, diblokir, sesi habis).
 */
export type PushDeniedCode =
  | "no_session"
  | "not_member"
  | "removed"
  | "blocked"
  | "missing"
  | "invalid_route"
  | "unknown";

export type PushDeniedNotice = {
  code: PushDeniedCode;
  title: string;
  detail: string;
  /** Rute pengganti yang dibuka setelah pengguna menutup penjelasan. */
  fallbackRoute: string;
  at: number;
};

type Listener = (n: PushDeniedNotice) => void;

const listeners = new Set<Listener>();
let last: PushDeniedNotice | null = null;

export function onPushDenied(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Publikasikan alasan penolakan; aman dipanggil dari mana saja. */
export function reportPushDenied(n: Omit<PushDeniedNotice, "at">): void {
  // Redam duplikat beruntun (SW + app bisa memicu jalur yang sama).
  const now = Date.now();
  if (last && last.code === n.code && last.detail === n.detail && now - last.at < 3000) return;
  last = { ...n, at: now };
  for (const fn of listeners) fn(last);
}
