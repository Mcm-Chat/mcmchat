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
};

const END_STATUS_TEXT: Record<string, string> = {
  ended: "berakhir",
  missed: "tak terjawab",
  declined: "ditolak",
  failed: "gagal",
};

/**
 * Ringkasan status panggilan untuk pembaca layar: mulai, tersambung,
 * terputus, atau gagal. Sengaja tanpa detik berjalan agar tidak berisik.
 */
export function callStatusAnnouncement(input: CallAnnouncementInput): string {
  const { phase, kind, name, reason, endStatus, durationSec } = input;
  const jenis = kind === "video" ? "Panggilan video" : "Panggilan suara";
  const suffix = reason ? ` ${reason}` : "";

  switch (phase) {
    case "outgoing":
      return `${jenis} keluar ke ${name}. Memanggil.`;
    case "incoming":
      return `${jenis} masuk dari ${name}.`;
    case "connecting":
      return `${jenis} dengan ${name} sedang menyambungkan.`;
    case "connected":
      return `${jenis} dengan ${name} tersambung dan dimulai.`;
    case "unconfigured":
      return `${jenis} tidak dapat dimulai karena penyedia panggilan belum terhubung.${suffix}`;
    case "error":
      return `${jenis} dengan ${name} gagal.${suffix}`;
    case "ended": {
      const label = END_STATUS_TEXT[endStatus ?? "ended"] ?? "berakhir";
      const dur =
        durationSec && durationSec > 0 ? ` Durasi ${durasi(durationSec)}.` : "";
      return `${jenis} dengan ${name} ${label}.${dur}${suffix}`;
    }
    default:
      return "";
  }
}
