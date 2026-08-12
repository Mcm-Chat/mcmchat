import { describe, expect, it } from "vitest";
import { curtainReducer, INITIAL_CURTAIN, readScreenSecurity } from "../screen-privacy";

describe("readScreenSecurity", () => {
  it("web tidak pernah mengklaim blokir screenshot", () => {
    const s = readScreenSecurity({});
    expect(s.platform).toBe("web");
    expect(s.flagSecure).toBe(false);
    expect(s.label).toContain("APK Android");
  });

  it("penanda native tanpa Capacitor tidak dipercaya", () => {
    const s = readScreenSecurity({ MCMNative: { screenSecurity: { flagSecure: true } } });
    expect(s.flagSecure).toBe(false);
  });

  it("APK dengan FLAG_SECURE dilaporkan aktif", () => {
    const s = readScreenSecurity({
      Capacitor: { isNativePlatform: () => true },
      MCMNative: { screenSecurity: { flagSecure: true, recentsScreenshotDisabled: true } },
    });
    expect(s.platform).toBe("android-apk");
    expect(s.recentsProtected).toBe(true);
    expect(s.label).toContain("diblokir");
  });
});

describe("curtainReducer", () => {
  it("menutup saat hidden/blur/pagehide", () => {
    for (const type of ["hidden", "blur", "pagehide"] as const) {
      expect(curtainReducer(INITIAL_CURTAIN, { type }).covered).toBe(true);
    }
  });

  it("tidak langsung membuka saat kembali fokus", () => {
    const covered = curtainReducer(INITIAL_CURTAIN, { type: "hidden" });
    const back = curtainReducer(covered, { type: "visible" });
    expect(back).toEqual({ covered: true, pendingReveal: true });
    expect(curtainReducer(back, { type: "frame-ready" })).toEqual(INITIAL_CURTAIN);
  });

  it("frame-ready tanpa pendingReveal tidak membuka tirai", () => {
    const covered = curtainReducer(INITIAL_CURTAIN, { type: "blur" });
    expect(curtainReducer(covered, { type: "frame-ready" })).toEqual(covered);
  });
});
