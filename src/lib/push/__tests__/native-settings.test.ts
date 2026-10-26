import { afterEach, beforeEach, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ openAppSettings: vi.fn(), openNotificationSettings: vi.fn() }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => bridge }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { openNativeAppSettings, openNotificationSettings } from "../native";
const setNative = (native: boolean) =>
  Object.defineProperty(window, "Capacitor", {
    configurable: true,
    value: { isNativePlatform: () => native },
  });
beforeEach(() => {
  vi.clearAllMocks();
  setNative(true);
});
afterEach(() => Reflect.deleteProperty(window, "Capacitor"));
it("uses the native bridge and reports actual activity-open results", async () => {
  bridge.openAppSettings.mockResolvedValue({ opened: true });
  bridge.openNotificationSettings.mockResolvedValue({ opened: false });
  expect(await openNativeAppSettings()).toEqual({ opened: true });
  expect(await openNotificationSettings()).toEqual({ opened: false });
  expect(bridge.openAppSettings).toHaveBeenCalledOnce();
  expect(bridge.openNotificationSettings).toHaveBeenCalledOnce();
});
it("reports missing plugins and unsupported browsers without claiming settings opened", async () => {
  bridge.openAppSettings.mockRejectedValue(new Error("not implemented"));
  bridge.openNotificationSettings.mockRejectedValue(new Error("not implemented"));
  expect(await openNativeAppSettings()).toEqual({ opened: false });
  expect(await openNotificationSettings()).toEqual({ opened: false });
  setNative(false);
  expect(await openNativeAppSettings()).toEqual({ opened: false });
  expect(await openNotificationSettings()).toEqual({ opened: false });
  expect(bridge.openAppSettings).toHaveBeenCalledOnce();
  expect(bridge.openNotificationSettings).toHaveBeenCalledOnce();
});

it("does not claim success for an older APK returning no activity-open result", async () => {
  bridge.openNotificationSettings.mockResolvedValue(undefined);
  expect(await openNotificationSettings()).toEqual({ opened: false });
});
