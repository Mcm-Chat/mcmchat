/** Automatic token refresh verifies server state and never opts in or revives a device. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) },
}));
let currentToken: string | null = "tok-1";
vi.mock("firebase/app", () => ({
  initializeApp: () => ({}),
  getApps: () => [],
  getApp: () => ({}),
}));
vi.mock("firebase/messaging", () => ({
  isSupported: async () => true,
  getMessaging: () => ({}),
  getToken: async () => currentToken,
  deleteToken: async () => true,
}));
vi.mock("../web-config", () => ({
  WEB_PUSH: { apiKey: "k", projectId: "p", senderId: "s", appId: "a", vapidKey: "v" },
  swUrl: () => "/firebase-messaging-sw.js",
  webPushConfigured: () => true,
}));
const reg = {} as ServiceWorkerRegistration;
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: { register: async () => reg, ready: Promise.resolve(reg) },
});
vi.stubGlobal("PushManager", class {});
const requestPermission = vi.fn();
const { syncWebPushToken } = await import("../web");

describe("syncWebPushToken", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: true, error: null });
    requestPermission.mockClear();
    localStorage.clear();
    currentToken = "tok-1";
    vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  });
  it("uses refresh-only RPC with stable installation identity", async () => {
    expect(await syncWebPushToken("Pixel")).toBe(true);
    const id = localStorage.getItem("mcm.web.installation");
    expect(rpc).toHaveBeenCalledWith(
      "refresh_my_push_device",
      expect.objectContaining({ _installation_id: id, _push_token: "tok-1", _platform: "web" }),
    );
    expect(requestPermission).not.toHaveBeenCalled();
  });
  it("checks the server even when an old local token record claims to be fresh", async () => {
    localStorage.setItem("mcm.web.push-token", JSON.stringify({ token: "tok-1", at: Date.now() }));
    await syncWebPushToken("Pixel");
    rpc.mockResolvedValueOnce({ data: false, error: null }); // revoked elsewhere
    expect(await syncWebPushToken("Pixel")).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("mcm.web.push-token")).toBeNull();
    expect(rpc.mock.calls.every(([fn]) => fn === "refresh_my_push_device")).toBe(true);
  });
  it("refreshes a rotated token without a registration call", async () => {
    await syncWebPushToken("Pixel");
    const id = localStorage.getItem("mcm.web.installation");
    rpc.mockClear();
    currentToken = "tok-2";
    expect(await syncWebPushToken("Pixel")).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "refresh_my_push_device",
      expect.objectContaining({ _installation_id: id, _push_token: "tok-2" }),
    );
  });
  it("does not register a missing or revoked device during refresh", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await syncWebPushToken("Pixel")).toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]?.[0]).toBe("refresh_my_push_device");
  });
  it("reports RPC errors and missing tokens as unregistered", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect(await syncWebPushToken("Pixel")).toBe(false);
    rpc.mockClear();
    currentToken = null;
    expect(await syncWebPushToken("Pixel")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not request permission when permission has not been granted", async () => {
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    expect(await syncWebPushToken("Pixel")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
