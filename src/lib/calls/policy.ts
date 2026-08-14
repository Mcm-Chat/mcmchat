/**
 * Kebijakan murni panggilan MCM.
 *
 * Berkas ini adalah cerminan aturan yang dijalankan RPC `join_call`,
 * `end_call`, dan `leave_call` di database. Implementasi klien memakai helper
 * yang sama supaya UI tidak pernah menebak — dan pengujian dapat memeriksa
 * aturan tanpa jaringan.
 */
export type CallStatusValue =
  | "ringing"
  | "ongoing"
  | "ended"
  | "missed"
  | "declined"
  | "failed"
  | "unconfigured";

/** Kode alasan resmi; teks bebas ditolak server. */
export const END_REASONS = [
  "timeout",
  "declined",
  "cancelled",
  "hangup",
  "failed",
  "unconfigured",
] as const;
export type EndReason = (typeof END_REASONS)[number];

export function isEndReason(value: string): value is EndReason {
  return (END_REASONS as readonly string[]).includes(value);
}

export const TERMINAL_STATUSES: CallStatusValue[] = ["ended", "missed", "declined", "failed"];
export const isTerminal = (s: CallStatusValue) => TERMINAL_STATUSES.includes(s);

export type Decision = { allowed: boolean; code: string };

/**
 * Masuk room media HANYA setelah panggilan benar-benar dijawab. Status
 * `ringing` ditolak: penerima menjawab dulu, baru kedua sisi bergabung.
 */
export function canJoinRoom(status: CallStatusValue): Decision {
  if (status === "ongoing") return { allowed: true, code: "ok" };
  if (status === "ringing") return { allowed: false, code: "call_not_answered" };
  return { allowed: false, code: "call_ended" };
}

/** Token panggilan nyata mengikuti aturan join yang sama, plus cek peserta. */
export function canIssueCallToken(input: {
  status: CallStatusValue;
  participantExists: boolean;
  participantLeft: boolean;
  hasRoom: boolean;
}): Decision {
  if (!input.participantExists) return { allowed: false, code: "not_participant" };
  if (input.participantLeft) return { allowed: false, code: "already_left" };
  if (!input.hasRoom) return { allowed: false, code: "call_invalid" };
  return canJoinRoom(input.status);
}

export type EndOutcome = { status: "ended" | "missed" | "declined" | "failed"; reason: EndReason };

/**
 * Pemisahan tegas: timeout 45 detik ≠ pemanggil membatalkan ≠ penerima menolak.
 */
export function resolveEndOutcome(input: {
  status: CallStatusValue;
  isInitiator: boolean;
  requested: EndOutcome["status"];
  reason: EndReason | null;
}): EndOutcome {
  if (input.status === "ringing") {
    if (input.requested === "missed" && input.reason === "timeout")
      return { status: "missed", reason: "timeout" };
    return input.isInitiator
      ? { status: "ended", reason: "cancelled" }
      : { status: "declined", reason: "declined" };
  }
  const status = input.requested === "failed" ? "failed" : "ended";
  const reason: EndReason =
    status === "failed"
      ? "failed"
      : input.reason && !["declined", "cancelled", "timeout"].includes(input.reason)
        ? input.reason
        : "hangup";
  return { status, reason };
}

/**
 * Keluar dari panggilan: 1:1 dan pemanggil grup mengakhiri; peserta grup biasa
 * hanya keluar selama masih ada peserta aktif lain.
 */
export function resolveLeaveOutcome(input: {
  status: CallStatusValue;
  isInitiator: boolean;
  totalParticipants: number;
  activeAfterLeave: number;
}): { endsCall: boolean; outcome: EndOutcome | null } {
  if (isTerminal(input.status)) return { endsCall: false, outcome: null };
  const ends =
    input.totalParticipants <= 2 || input.isInitiator || input.activeAfterLeave === 0;
  if (!ends) return { endsCall: false, outcome: null };
  if (input.status === "ringing")
    return {
      endsCall: true,
      outcome: input.isInitiator
        ? { status: "ended", reason: "cancelled" }
        : { status: "declined", reason: "declined" },
    };
  return { endsCall: true, outcome: { status: "ended", reason: "hangup" } };
}
