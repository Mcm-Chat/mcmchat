const KEY = "mcm:calls:return-focus";

/** Target fokus khusus tombol "Panggilan baru" (panggilan tanpa riwayat terkait). */
export const CALL_RETURN_FOCUS_NEW = "new";

/** Id tombol panggil ulang pada daftar riwayat panggilan. */
export const redialButtonId = (callId: string) => `redial-call-${callId}`;

/** Simpan tombol mana yang harus difokuskan setelah kembali ke halaman Panggilan. */
export function setCallReturnFocus(target: string) {
  try {
    sessionStorage.setItem(KEY, target);
  } catch {
    /* storage tidak tersedia — fokus fallback saja */
  }
}

/** Ambil sekali lalu bersihkan target fokus tersimpan. */
export function consumeCallReturnFocus(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
