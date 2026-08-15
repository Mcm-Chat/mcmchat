import type { CallPhase } from "@/lib/calls/use-call";
import { durasi } from "@/lib/mcm/format";

export type CallAnnouncementInput = {
  phase: CallPhase;
  kind: "audio" | "video";
  name: string;
  reason?: string | null;
  /** Status akhir dari database saat panggilan tidak lagi berjalan. */
  endStatus?: string | null;
  durationSec?: number | null;
  /** Percobaan sambung ulang sedang berjalan. */
  retrying?: boolean;
  /** Kualitas jaringan lokal — hanya diumumkan saat benar-benar buruk. */
  quality?: "excellent" | "good" | "poor" | "unknown";
  /** Autoplay audio diblokir browser sehingga suara lawan bicara belum terdengar. */
  audioBlocked?: boolean;
};

const END_STATUS_TEXT: Record<string, string> = {
  ended: "berakhir",
  missed: "tak terjawab",
  declined: "ditolak",
  failed: "gagal",
};

/**
 * Ringkasan status panggilan untuk pembaca layar: berdering, menyambungkan,
 * tersambung, terputus, atau gagal. Sengaja tanpa detik berjalan agar tidak
 * berisik — durasi diumumkan terpisah setiap menit.
 */
export function callStatusAnnouncement(input: CallAnnouncementInput): string {
  const { phase, kind, name, reason, endStatus, durationSec, retrying, quality, audioBlocked } =
    input;
  const jenis = kind === "video" ? "Panggilan video" : "Panggilan suara";
  const suffix = reason ? ` ${reason}` : "";

  switch (phase) {
    case "outgoing":
      return `${jenis} keluar ke ${name}. Berdering, menunggu dijawab.`;
    case "incoming":
      return `${jenis} masuk dari ${name}. Berdering — tekan A untuk menjawab atau T untuk menolak.`;
    case "connecting":
      return retrying
        ? `${jenis} dengan ${name} sedang mencoba tersambung kembali.`
        : `${jenis} dengan ${name} sedang menyambungkan.`;
    case "connected": {
      const net = quality === "poor" ? " Sinyal lemah, kualitas suara bisa menurun." : "";
      const blocked = audioBlocked
        ? " Suara masuk diblokir browser — aktifkan suara untuk mendengar lawan bicara."
        : "";
      return `${jenis} dengan ${name} tersambung dan dimulai.${net}${blocked}`;
    }
    case "unconfigured":
      return `${jenis} tidak dapat dimulai karena penyedia panggilan belum terhubung.${suffix}`;
    case "error":
      return `${jenis} dengan ${name} gagal.${suffix}`;
    case "ended": {
      const label = END_STATUS_TEXT[endStatus ?? "ended"] ?? "berakhir";
      const dur = durationSec && durationSec > 0 ? ` Durasi ${durasi(durationSec)}.` : "";
      return `${jenis} dengan ${name} ${label}.${dur}${suffix}`;
    }
    default:
      return "";
  }
}

/** Perubahan penting wajib memotong antrean pembaca layar. */
export function isUrgentPhase(phase: CallPhase): boolean {
  return phase === "incoming" || phase === "error" || phase === "unconfigured";
}
