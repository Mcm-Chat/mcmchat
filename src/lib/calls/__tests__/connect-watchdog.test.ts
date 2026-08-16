import { describe, expect, it } from "vitest";
import {
  CONNECT_MAX_RECOVERIES,
  CONNECT_TIMEOUT_MS,
  canAutoRecover,
  connectStageMessage,
  connectTimeoutMs,
} from "../connect-watchdog";
import { callConnectionStatus } from "../connection-status";

describe("connect watchdog", () => {
  it("menaikkan batas waktu tiap ronde", () => {
    expect(connectTimeoutMs(0)).toBe(CONNECT_TIMEOUT_MS);
    expect(connectTimeoutMs(1)).toBeGreaterThan(connectTimeoutMs(0));
  });

  it("berhenti memulihkan setelah kuota habis", () => {
    expect(canAutoRecover(0)).toBe(true);
    expect(canAutoRecover(CONNECT_MAX_RECOVERIES)).toBe(false);
  });

  it("menyebut ronde pada pesan pemulihan", () => {
    expect(connectStageMessage("recovering", 1)).toContain("1 dari 2");
    expect(connectStageMessage("slow")).toMatch(/lambat/i);
    expect(connectStageMessage("stalled")).toMatch(/Coba lagi/);
  });

  it("status macet tidak memakai nada error", () => {
    const s = callConnectionStatus({ phase: "connecting", stalled: true });
    expect(s.tone).toBe("warn");
    expect(s.label).toBe("Sambungan tertahan");
  });
});
