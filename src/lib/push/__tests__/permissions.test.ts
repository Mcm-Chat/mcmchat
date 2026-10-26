import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPermission, openAppSettings, requestPermission } from "../permissions";
import { isNative, openNativeAppSettings, pushCapabilities } from "../native";

vi.mock("../native", () => ({
  isNative: vi.fn(() => false),
  openNativeAppSettings: vi.fn(async () => ({ opened: false })),
  pushCapabilities: vi.fn(async () => null),
  requestNativeNotificationPermission: vi.fn(async () => false),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("real permission requests", () => {
  it("reports unsupported missing media/geolocation APIs instead of claiming denial", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPermission("camera")).toBe("unsupported");
    expect(await requestPermission("microphone")).toBe("unsupported");
    expect(await requestPermission("location")).toBe("unsupported");
  });

  it("keeps real request actions available when a WebView cannot query permission status", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn() },
      geolocation: { getCurrentPosition: vi.fn() },
    });
    expect(await checkPermission("camera")).toBe("prompt");
    expect(await checkPermission("microphone")).toBe("prompt");
    expect(await checkPermission("location")).toBe("prompt");
  });

  it("requests only the selected media and releases every track immediately", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    expect(await requestPermission("microphone")).toBe("granted");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("distinguishes refused access from missing or busy hardware", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("missing", "NotFoundError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    expect(await requestPermission("camera")).toBe("unsupported");
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    expect(await requestPermission("camera")).toBe("denied");
  });

  it("does not treat a location timeout as a permission refusal", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) =>
          fail({ code: 3 }),
      },
    });
    expect(await requestPermission("location")).toBe("unsupported");
  });

  it("does not invent a persistent photo-library permission", async () => {
    expect(await checkPermission("photos")).toBe("unsupported");
    expect(await requestPermission("photos")).toBe("unsupported");
  });

  it("uses the shipped native bridge for application settings and reports failures", async () => {
    vi.mocked(openNativeAppSettings).mockResolvedValueOnce({ opened: true });
    expect(await openAppSettings()).toBe(true);
    expect(await openAppSettings()).toBe(false);
  });

  it("does not report unavailable native capability checks as granted", async () => {
    vi.mocked(isNative).mockReturnValueOnce(true);
    vi.mocked(pushCapabilities).mockResolvedValueOnce(null);
    expect(await checkPermission("notifications")).toBe("unsupported");
  });
});
