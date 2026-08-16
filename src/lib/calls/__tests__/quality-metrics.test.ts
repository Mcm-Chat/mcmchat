import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  formatMetric,
  gradeMetrics,
  metricsSummary,
  snapshotFromStats,
  type QualitySnapshot,
} from "../quality-metrics";

const base: QualitySnapshot = {
  ts: 0,
  packetsReceived: 0,
  packetsLost: 0,
  bytesReceived: 0,
  bytesSent: 0,
  jitterMs: null,
  rttMs: null,
};

describe("quality-metrics", () => {
  it("meringkas stats WebRTC jadi satu cuplikan", () => {
    const snap = snapshotFromStats(
      [
        [
          {
            type: "inbound-rtp",
            packetsReceived: 100,
            packetsLost: 5,
            bytesReceived: 2000,
            jitter: 0.02,
          },
          { type: "outbound-rtp", bytesSent: 1000 },
          { type: "candidate-pair", currentRoundTripTime: 0.12 },
        ],
      ],
      1000,
    );
    expect(snap.packetsReceived).toBe(100);
    expect(snap.packetsLost).toBe(5);
    expect(snap.jitterMs).toBeCloseTo(20);
    expect(snap.rttMs).toBeCloseTo(120);
  });

  it("menghitung loss dan bitrate dari selisih dua cuplikan", () => {
    const prev = {
      ...base,
      ts: 0,
      packetsReceived: 100,
      packetsLost: 0,
      bytesReceived: 1000,
      bytesSent: 500,
    };
    const next = {
      ...base,
      ts: 2000,
      packetsReceived: 190,
      packetsLost: 10,
      bytesReceived: 5000,
      bytesSent: 2500,
      jitterMs: 12,
    };
    const m = diffSnapshots(prev, next)!;
    expect(m.lossPct).toBeCloseTo(10);
    expect(m.kbpsDown).toBeCloseTo(16);
    expect(m.kbpsUp).toBeCloseTo(8);
    expect(m.jitterMs).toBe(12);
  });

  it("menolak jendela waktu tidak valid", () => {
    expect(diffSnapshots({ ...base, ts: 100 }, { ...base, ts: 100 })).toBeNull();
  });

  it("memberi nilai kualitas sesuai ambang", () => {
    expect(gradeMetrics(null)).toBe("unknown");
    expect(gradeMetrics({ lossPct: 0.2, jitterMs: 8, rttMs: 80, kbpsDown: 40, kbpsUp: 30 })).toBe(
      "good",
    );
    expect(gradeMetrics({ lossPct: 3, jitterMs: 10, rttMs: 90, kbpsDown: 40, kbpsUp: 30 })).toBe(
      "fair",
    );
    expect(gradeMetrics({ lossPct: 9, jitterMs: 10, rttMs: 90, kbpsDown: 40, kbpsUp: 30 })).toBe(
      "poor",
    );
  });

  it("memformat angka dan ringkasan", () => {
    expect(formatMetric(null, "ms")).toBe("—");
    expect(formatMetric(2.34, "%")).toBe("2.3%");
    expect(formatMetric(120.6, "kbps")).toBe("121 kbps");
    expect(metricsSummary(null)).toMatch(/belum terukur/);
    expect(
      metricsSummary({ lossPct: 0, jitterMs: 5, rttMs: 50, kbpsDown: 30, kbpsUp: 20 }),
    ).toMatch(/Kualitas baik/);
  });
});
