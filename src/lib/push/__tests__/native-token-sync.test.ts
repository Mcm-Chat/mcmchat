import { afterEach, beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  consumePendingFcmToken: vi.fn(),
  getToken: vi.fn(),
  getInstallationId: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/core", () => ({ registerPlugin: () => bridge }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { syncRotatedToken } from "../native";
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => true },
  });
  bridge.consumePendingFcmToken.mockResolvedValue({ token: null });
  bridge.getToken.mockResolvedValue({ token: "current-token" });
  bridge.getInstallationId.mockResolvedValue({ installationId: "android-installation" });
  rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => Reflect.deleteProperty(window, "Capacitor"));
it("verifies the current native token even without a pending rotation", async () => {
  expect(await syncRotatedToken("Pixel")).toBe(true);
  expect(rpc).toHaveBeenCalledWith(
    "refresh_my_push_device",
    expect.objectContaining({
      _push_token: "current-token",
      _installation_id: "android-installation",
    }),
  );
});
it("refreshes a rotated token but never registers or revives a revoked device", async () => {
  bridge.consumePendingFcmToken.mockResolvedValueOnce({ token: "rotated-token" });
  rpc.mockResolvedValueOnce({ data: false, error: null });
  expect(await syncRotatedToken("Pixel")).toBe(false);
  expect(rpc).toHaveBeenCalledWith(
    "refresh_my_push_device",
    expect.objectContaining({ _push_token: "rotated-token" }),
  );
  expect(rpc).toHaveBeenCalledOnce();
  expect(bridge.getToken).not.toHaveBeenCalled();
});
it("does not claim registration when refresh fails", async () => {
  rpc.mockRejectedValueOnce(new Error("network down"));
  expect(await syncRotatedToken("Pixel")).toBe(false);
});
