/**
 * Registrasi token FCM untuk perangkat asli: token web berotasi diam-diam,
 * jadi baris perangkat di server harus ikut diperbarui tanpa dialog izin baru.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args) },
}));

let currentToken: string | null = "tok-1";
vi.mock("firebase/app", () => ({ initializeApp: () => ({}), getApps: () => [], getApp: () => ({}) }));
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
vi.stubGlobal("Notification", { permission: "granted" });

const { syncWebPushToken } = await import("../web");

describe("syncWebPushToken", () => {
  beforeEach(() => {
    rpc.mockClear();
    localStorage.clear();
    currentToken = "tok-1";
  });

  it("mendaftarkan token saat belum ada catatan lokal", async () => {
    expect(await syncWebPushToken("Pixel")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ _push_token: "tok-1", _platform: "web" });
  });

  it("tidak menulis ulang saat token sama dan masih segar", async () => {
    await syncWebPushToken("Pixel");
    rpc.mockClear();
    expect(await syncWebPushToken("Pixel")).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("menulis ulang saat token berotasi", async () => {
    await syncWebPushToken("Pixel");
    rpc.mockClear();
    currentToken = "tok-2";
    expect(await syncWebPushToken("Pixel")).toBe(true);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ _push_token: "tok-2" });
  });

  it("menyegarkan ulang setelah lebih dari 24 jam walau token sama", async () => {
    await syncWebPushToken("Pixel");
    const raw = JSON.parse(localStorage.getItem("mcm.web.push-token")!);
    localStorage.setItem(
      "mcm.web.push-token",
      JSON.stringify({ ...raw, at: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    rpc.mockClear();
    expect(await syncWebPushToken("Pixel")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("tidak melakukan apa pun saat izin belum diberikan", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    expect(await syncWebPushToken("Pixel")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    vi.stubGlobal("PushManager", class {});
vi.stubGlobal("Notification", { permission: "granted" });
  });
});
