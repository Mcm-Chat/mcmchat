import type { CallHistoryItem } from "@/lib/api/calls";

/**
 * Hasil akhir panggilan yang dipahami pengguna. Berbeda dengan `status` mentah
 * dari server: panggilan keluar yang ditutup sebelum diangkat dilaporkan
 * sebagai "dibatalkan", bukan sekadar "selesai" berdurasi 0.
 */
export type CallOutcome = "live" | "answered" | "missed" | "declined" | "cancelled" | "failed";

export function callOutcome(call: CallHistoryItem, userId?: string): CallOutcome {
  if (call.status === "ringing" || call.status === "ongoing") return "live";
  if (call.status === "declined") return "declined";
  if (call.status === "failed" || call.status === "unconfigured") return "failed";
  const answered = Boolean(call.answered_at) || call.duration_sec > 0;
  if (answered) return "answered";
  // Tidak pernah diangkat: keluar = dibatalkan penelepon, masuk = tak terjawab.
  return call.initiator_id === userId ? "cancelled" : "missed";
}

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  live: "Berlangsung",
  answered: "Terjawab",
  missed: "Tak terjawab",
  declined: "Ditolak",
  cancelled: "Dibatalkan",
  failed: "Gagal",
};

/** Kelas badge per hasil, memakai token semantik tema. */
export const OUTCOME_BADGE: Record<CallOutcome, string> = {
  live: "bg-success/10 text-success",
  answered: "bg-success/10 text-success",
  missed: "bg-destructive/10 text-destructive",
  declined: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};
