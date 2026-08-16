/**
 * Metrik kualitas panggilan (packet loss, jitter, bitrate, RTT).
 *
 * Nilai diambil dari RTCStatsReport WebRTC yang bersifat kumulatif, jadi angka
 * yang berarti hanya bisa dihitung dari selisih dua cuplikan. Modul ini murni
 * (tanpa DOM/LiveKit) supaya bisa diuji dan dipakai ulang oleh diagnostik.
 */

/** Cuplikan mentah kumulatif pada satu waktu. */
export type QualitySnapshot = {
  ts: number;
  packetsReceived: number;
  packetsLost: number;
  bytesReceived: number;
  bytesSent: number;
  /** Jitter inbound terakhir (ms); null bila tidak dilaporkan. */
  jitterMs: number | null;
  /** Round-trip time terakhir (ms); null bila tidak dilaporkan. */
  rttMs: number | null;
};

/** Hasil olahan yang ditampilkan di layar. */
export type QualityMetrics = {
  /** Persentase paket hilang pada jendela terakhir; null bila tak ada data. */
  lossPct: number | null;
  jitterMs: number | null;
  rttMs: number | null;
  /** Bitrate masuk/keluar dalam kbps pada jendela terakhir. */
  kbpsDown: number;
  kbpsUp: number;
};

export type QualityGrade = "good" | "fair" | "poor" | "unknown";

type StatLike = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Ringkas kumpulan RTCStatsReport menjadi satu cuplikan.
 * Beberapa report (audio + video, lokal + remote) dijumlahkan.
 */
export function snapshotFromStats(reports: Iterable<StatLike>[], now: number): QualitySnapshot {
  const snap: QualitySnapshot = {
    ts: now,
    packetsReceived: 0,
    packetsLost: 0,
    bytesReceived: 0,
    bytesSent: 0,
    jitterMs: null,
    rttMs: null,
  };
  for (const report of reports) {
    for (const stat of report) {
      const type = stat["type"];
      if (type === "inbound-rtp") {
        snap.packetsReceived += num(stat["packetsReceived"]);
        snap.packetsLost += num(stat["packetsLost"]);
        snap.bytesReceived += num(stat["bytesReceived"]);
        const j = stat["jitter"];
        if (typeof j === "number" && Number.isFinite(j))
          snap.jitterMs = Math.max(snap.jitterMs ?? 0, j * 1000);
      } else if (type === "outbound-rtp") {
        snap.bytesSent += num(stat["bytesSent"]);
      } else if (type === "remote-inbound-rtp" || type === "candidate-pair") {
        const rtt = stat["roundTripTime"] ?? stat["currentRoundTripTime"];
        if (typeof rtt === "number" && Number.isFinite(rtt) && rtt > 0)
          snap.rttMs = Math.max(snap.rttMs ?? 0, rtt * 1000);
      }
    }
  }
  return snap;
}

/** Hitung metrik dari selisih dua cuplikan; null bila jendela tidak valid. */
export function diffSnapshots(prev: QualitySnapshot, next: QualitySnapshot): QualityMetrics | null {
  const dtMs = next.ts - prev.ts;
  if (dtMs <= 0) return null;
  const dRecv = Math.max(0, next.packetsReceived - prev.packetsReceived);
  const dLost = Math.max(0, next.packetsLost - prev.packetsLost);
  const total = dRecv + dLost;
  const seconds = dtMs / 1000;
  return {
    lossPct: total > 0 ? (dLost / total) * 100 : null,
    jitterMs: next.jitterMs,
    rttMs: next.rttMs,
    kbpsDown: Math.max(0, ((next.bytesReceived - prev.bytesReceived) * 8) / 1000 / seconds),
    kbpsUp: Math.max(0, ((next.bytesSent - prev.bytesSent) * 8) / 1000 / seconds),
  };
}

/** Nilai kualitas gabungan untuk warna indikator. */
export function gradeMetrics(m: QualityMetrics | null): QualityGrade {
  if (!m) return "unknown";
  const loss = m.lossPct;
  const jitter = m.jitterMs;
  const rtt = m.rttMs;
  if ((loss ?? 0) > 5 || (jitter ?? 0) > 60 || (rtt ?? 0) > 400) return "poor";
  if ((loss ?? 0) > 2 || (jitter ?? 0) > 30 || (rtt ?? 0) > 250) return "fair";
  if (loss === null && jitter === null) return "unknown";
  return "good";
}

/** Angka siap tampil (Bahasa Indonesia, tanpa satuan berlebih). */
export function formatMetric(value: number | null, unit: "%" | "ms" | "kbps"): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = unit === "%" ? 1 : 0;
  return `${value.toFixed(digits)} ${unit}`.replace(" %", "%");
}

/** Ringkasan satu baris untuk pembaca layar. */
export function metricsSummary(m: QualityMetrics | null): string {
  if (!m) return "Kualitas panggilan belum terukur.";
  const grade = gradeMetrics(m);
  const label =
    grade === "good"
      ? "Kualitas baik"
      : grade === "fair"
        ? "Kualitas sedang"
        : grade === "poor"
          ? "Kualitas buruk"
          : "Kualitas belum terukur";
  return `${label}. Paket hilang ${formatMetric(m.lossPct, "%")}, jitter ${formatMetric(m.jitterMs, "ms")}, unduh ${formatMetric(m.kbpsDown, "kbps")}, unggah ${formatMetric(m.kbpsUp, "kbps")}.`;
}
