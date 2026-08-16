/**
 * Pemulihan posisi baca & fokus komposer per percakapan.
 *
 * Disimpan di sessionStorage (per akun, via scopedKey) agar saat pengguna
 * menutup lalu membuka kembali chat yang sama, ia kembali ke posisi bacanya —
 * bukan dilempar ke dasar. Kedaluwarsa singkat supaya tidak "mengunci" pengguna
 * di riwayat lama berhari-hari kemudian.
 */
import { scopedKey } from "@/lib/session-scope";

export const RESTORE_TTL_MS = 6 * 60 * 60 * 1000;

export type ChatViewState = {
  /** scrollTop terakhir (px). */
  top: number;
  /** True bila pengguna memang berada di pesan terbaru saat meninggalkan layar. */
  atBottom: boolean;
  /** True bila komposer sedang fokus saat meninggalkan layar. */
  composerFocused: boolean;
  /** Waktu simpan (ms epoch). */
  savedAt: number;
};

export function chatViewKey(conversationId: string): string {
  return scopedKey(`chat-view:${conversationId}`);
}

export function saveChatView(conversationId: string, state: Omit<ChatViewState, "savedAt">): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      chatViewKey(conversationId),
      JSON.stringify({ ...state, savedAt: Date.now() } satisfies ChatViewState),
    );
  } catch {
    /* storage penuh / mode privat: abaikan */
  }
}

export function loadChatView(conversationId: string, now = Date.now()): ChatViewState | null {
  if (typeof sessionStorage === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(chatViewKey(conversationId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChatViewState>;
    if (typeof parsed.top !== "number" || typeof parsed.savedAt !== "number") return null;
    if (now - parsed.savedAt > RESTORE_TTL_MS) {
      clearChatView(conversationId);
      return null;
    }
    return {
      top: Math.max(0, parsed.top),
      atBottom: parsed.atBottom !== false,
      composerFocused: parsed.composerFocused === true,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearChatView(conversationId: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(chatViewKey(conversationId));
  } catch {
    /* abaikan */
  }
}

/** Perlu memulihkan posisi (bukan sekadar turun ke dasar)? */
export function shouldRestoreScroll(state: ChatViewState | null): state is ChatViewState {
  return !!state && !state.atBottom && state.top > 0;
}
