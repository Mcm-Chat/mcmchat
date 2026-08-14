import { describe, expect, it } from "vitest";
import {
  deviceErrorMessage,
  mediaDevicesCheck,
  overallStatus,
  permissionCheck,
  providerCheck,
  secureContextCheck,
} from "../diagnostics";
import { ringRemainingMs, RING_TIMEOUT_MS } from "@/lib/api/calls";

describe("diagnostik panggilan", () => {
  it("menandai penyedia yang belum dikonfigurasi sebagai gagal dengan langkah perbaikan", () => {
    const r = providerCheck(false);
    expect(r.status).toBe("fail");
    expect(r.action).toMatch(/LIVEKIT_URL/);
    expect(providerCheck(true).status).toBe("pass");
  });

  it("mengizinkan localhost tanpa HTTPS tetapi menolak host lain", () => {
    expect(secureContextCheck(false, "localhost").status).toBe("pass");
    expect(secureContextCheck(false, "mcmchat.ai").status).toBe("fail");
    expect(secureContextCheck(true, "mcmchat.ai").status).toBe("pass");
  });

  it("memetakan status izin ke tindakan yang benar", () => {
    expect(permissionCheck("mic", "granted").status).toBe("pass");
    expect(permissionCheck("mic", "denied").status).toBe("fail");
    expect(permissionCheck("camera", "prompt").status).toBe("warn");
    expect(permissionCheck("camera", "unsupported").status).toBe("warn");
  });

  it("mengutamakan kegagalan pada ringkasan", () => {
    expect(
      overallStatus([providerCheck(true), permissionCheck("mic", "prompt"), providerCheck(false)]),
    ).toBe("fail");
    expect(overallStatus([providerCheck(true), mediaDevicesCheck(true)])).toBe("pass");
  });

  it("menerjemahkan error perangkat menjadi pesan yang bisa ditindaklanjuti", () => {
    expect(deviceErrorMessage("NotAllowedError").code).toBe("device_denied");
    expect(deviceErrorMessage("NotReadableError").message).toMatch(/aplikasi lain/);
    expect(deviceErrorMessage("Aneh").code).toBe("device_error");
  });
});

describe("timeout dering absolut", () => {
  const now = Date.parse("2026-01-01T00:00:30.000Z");

  it("mengurangi waktu yang sudah berlalu sejak panggilan dibuat", () => {
    const created = "2026-01-01T00:00:00.000Z";
    expect(ringRemainingMs(created, now)).toBe(RING_TIMEOUT_MS - 30_000);
  });

  it("tidak pernah negatif untuk dering yang sudah kedaluwarsa", () => {
    expect(ringRemainingMs("2025-12-31T23:00:00.000Z", now)).toBe(0);
  });
});
