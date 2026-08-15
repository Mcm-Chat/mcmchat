/**
 * Persistensi status panggilan terakhir + target tindakan pemulihannya.
 *
 * Tanpa ini, refresh atau berpindah halaman saat panggilan gagal membuat UI
 * kembali ke state netral ("memuat"/"selesai") sehingga panel pemulihan dan
 * fokusnya hilang. Data disimpan per akun (scopedKey) dan kedaluwarsa singkat
 * supaya tidak pernah menampilkan status basi.
 */
import { scopedKey } from "@/lib/session-scope";

export type LastCallPhase =
  "connecting" | "connected" | "outgoing" | "incoming" | "ended" | "error" | "unconfigured";

/** Tindakan pemulihan yang harus difokuskan saat UI dibangun ulang. */
export type RecoveryTarget = "retry" | "devices" | "provider" | "back";

export type LastCallState = {
  callId: string;
  phase: LastCallPhase;
  reason: string | null;
  /** Panel pemulihan sedang ditutup pengguna (jangan dibuka lagi otomatis). */
  dismissed: boolean;
  recovery: RecoveryTarget;
  at: number;
};

/** Status lebih tua dari ini dianggap basi dan diabaikan. */
export const LAST_CALL_TTL_MS = 30 * 60 * 1000;

const key = () => scopedKey("calls.last-state");

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveLastCallState(state: Omit<LastCallState, "at">, now = Date.now()) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key(), JSON.stringify({ ...state, at: now } satisfies LastCallState));
  } catch {
    /* kuota penuh / mode privat — status terakhir bersifat opsional */
  }
}

export function loadLastCallState(callId?: string, now = Date.now()): LastCallState | null {
  const s = storage();
  if (!s) return null;
  let raw: string | null = null;
  try {
    raw = s.getItem(key());
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearLastCallState();
    return null;
  }
  const v = parsed as Partial<LastCallState> | null;
  if (!v || typeof v.callId !== "string" || typeof v.phase !== "string") return null;
  if (typeof v.at !== "number" || now - v.at > LAST_CALL_TTL_MS) {
    clearLastCallState();
    return null;
  }
  if (callId && v.callId !== callId) return null;
  return {
    callId: v.callId,
    phase: v.phase as LastCallPhase,
    reason: typeof v.reason === "string" ? v.reason : null,
    dismissed: v.dismissed === true,
    recovery: (v.recovery as RecoveryTarget) ?? "retry",
    at: v.at,
  };
}

export function clearLastCallState() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key());
  } catch {
    /* abaikan */
  }
}
