import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLastCallState,
  loadLastCallState,
  saveLastCallState,
  LAST_CALL_TTL_MS,
} from "@/lib/calls/last-call-state";

describe("last-call-state", () => {
  beforeEach(() => localStorage.clear());

  it("menyimpan dan memulihkan status gagal beserta target pemulihan", () => {
    saveLastCallState({
      callId: "c1",
      phase: "error",
      reason: "jaringan",
      dismissed: false,
      recovery: "retry",
    });
    const v = loadLastCallState("c1");
    expect(v?.phase).toBe("error");
    expect(v?.recovery).toBe("retry");
  });

  it("mengabaikan status milik panggilan lain dan status basi", () => {
    saveLastCallState(
      { callId: "c1", phase: "error", reason: null, dismissed: true, recovery: "back" },
      1000,
    );
    expect(loadLastCallState("c2", 1000)).toBeNull();
    expect(loadLastCallState("c1", 1000 + LAST_CALL_TTL_MS + 1)).toBeNull();
  });

  it("clear menghapus status", () => {
    saveLastCallState({ callId: "c1", phase: "ended", reason: null, dismissed: false, recovery: "back" });
    clearLastCallState();
    expect(loadLastCallState("c1")).toBeNull();
  });
});
