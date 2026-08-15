import { describe, expect, it } from "vitest";
import {
  canAnswer,
  classifyMediaError,
  mediaPermissionCopy,
  requiredPermissions,
} from "../media-permission";

describe("media-permission", () => {
  it("panggilan video butuh mic + kamera", () => {
    expect(requiredPermissions("audio")).toEqual(["microphone"]);
    expect(requiredPermissions("video")).toEqual(["microphone", "camera"]);
  });

  it("mengklasifikasi error getUserMedia", () => {
    expect(classifyMediaError(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe("denied");
    expect(classifyMediaError(Object.assign(new Error("x"), { name: "NotFoundError" }))).toBe("missing");
    expect(classifyMediaError(Object.assign(new Error("x"), { name: "NotReadableError" }))).toBe("busy");
  });

  it("hanya granted yang boleh menjawab", () => {
    expect(canAnswer("granted")).toBe(true);
    for (const s of ["prompt", "denied", "busy", "missing", "unsupported", "checking"] as const) {
      expect(canAnswer(s)).toBe(false);
    }
  });

  it("status ditolak memberi jalan keluar", () => {
    const copy = mediaPermissionCopy("denied", "audio");
    expect(copy.action).toBe("Periksa lagi");
    expect(copy.help).toMatch(/Pengaturan/);
  });
});
