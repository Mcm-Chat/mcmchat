import { describe, expect, it } from "vitest";
import { parseContactScan } from "../scan";

describe("parseContactScan", () => {
  it("menerima PIN mentah", () => {
    expect(parseContactScan("EGR7-W7RH")).toBe("EGR7-W7RH");
    expect(parseContactScan(" egr7w7rh ")).toBe("EGR7-W7RH");
  });
  it("menerima skema mcm://contact", () => {
    expect(parseContactScan("mcm://contact/EGR7-W7RH")).toBe("EGR7-W7RH");
    expect(parseContactScan("mcm://pin/egr7-w7rh")).toBe("EGR7-W7RH");
  });
  it("menerima tautan HTTPS MCM", () => {
    expect(parseContactScan("https://mcmchat.id/contact/EGR7-W7RH")).toBe("EGR7-W7RH");
    expect(parseContactScan("https://www.mcmchat.ai/c/EGR7-W7RH")).toBe("EGR7-W7RH");
  });
  it("menerima payload JSON MCM", () => {
    expect(parseContactScan('{"v":1,"type":"mcm.contact","pin":"EGR7-W7RH"}')).toBe("EGR7-W7RH");
  });
  it("menolak payload asing", () => {
    for (const bad of [
      "https://evil.example/contact/EGR7-W7RH",
      "WIFI:S:kantor;T:WPA;P:rahasia;;",
      '{"type":"other","pin":"EGR7-W7RH"}',
      "silakan tambahkan EGR7-W7RH sekarang",
      "EGR7-W7R", // panjang salah
      "IOL1-W7RH", // karakter ambigu tidak diizinkan
      "",
    ]) {
      expect(parseContactScan(bad)).toBeNull();
    }
  });
});
