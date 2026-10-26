import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  native: true,
  active: false,
  navigate: vi.fn(),
  registerNative: vi.fn(),
  registerWeb: vi.fn(),
  syncNative: vi.fn(),
  syncWeb: vi.fn(),
  checkPermission: vi.fn(),
  requestPermission: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => backend.navigate }));
vi.mock("../native", () => ({
  isNative: () => backend.native,
  nativeReceiverInstalled: () => backend.native,
  registerNativePush: (...args: unknown[]) => backend.registerNative(...args),
  syncRotatedToken: (...args: unknown[]) => backend.syncNative(...args),
  ensureChannels: vi.fn(),
  attachPushListeners: () => () => undefined,
}));
vi.mock("../web", () => ({
  webPushReady: () => ({ ok: true }),
  registerWebPush: (...args: unknown[]) => backend.registerWeb(...args),
  syncWebPushToken: (...args: unknown[]) => backend.syncWeb(...args),
  attachWebPushListeners: () => () => undefined,
}));
vi.mock("../permissions", () => ({
  checkPermission: (...args: unknown[]) => backend.checkPermission(...args),
  requestPermission: (...args: unknown[]) => backend.requestPermission(...args),
}));

import {
  enablePush,
  refreshPushSession,
  resetPushSession,
  usePushSession,
  usePushState,
} from "../use-push";

beforeEach(() => {
  vi.clearAllMocks();
  backend.native = true;
  backend.active = false;
  backend.checkPermission.mockResolvedValue("granted");
  backend.requestPermission.mockResolvedValue("granted");
  backend.syncNative.mockImplementation(async () => backend.active);
  backend.syncWeb.mockImplementation(async () => backend.active);
  const register = async () => {
    backend.active = true;
    return { registered: true };
  };
  backend.registerNative.mockImplementation(register);
  backend.registerWeb.mockImplementation(register);
});
afterEach(() => {
  cleanup();
  resetPushSession();
});

for (const native of [true, false]) {
  describe(native ? "Android push revocation" : "web push revocation", () => {
    it("opening a granted-permission app does not opt in a new device", async () => {
      backend.native = native;
      const { result } = renderHook(() => {
        usePushSession("user-a");
        return usePushState();
      });
      await waitFor(() => expect(result.current.permission).toBe("granted"));
      expect(result.current.registered).toBe(false);
      expect(backend.registerNative).not.toHaveBeenCalled();
      expect(backend.registerWeb).not.toHaveBeenCalled();
      expect(backend.requestPermission).not.toHaveBeenCalled();
    });

    it("revocation survives resume and only explicit enable can reactivate", async () => {
      backend.native = native;
      backend.active = true;
      const { result } = renderHook(() => {
        usePushSession("user-a");
        return usePushState();
      });
      await waitFor(() => expect(result.current.registered).toBe(true));
      backend.active = false; // server-side revocation from any device
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
      await waitFor(() => expect(result.current.registered).toBe(false));
      expect(backend.active).toBe(false);
      expect(backend.registerNative).not.toHaveBeenCalled();
      expect(backend.registerWeb).not.toHaveBeenCalled();
      await act(async () => {
        await enablePush("user-a");
      });
      expect(result.current.registered).toBe(true);
      expect(backend.active).toBe(true);
      expect(native ? backend.registerNative : backend.registerWeb).toHaveBeenCalledOnce();
      expect(backend.requestPermission).toHaveBeenCalledOnce();
    });
  });
}

it("does not publish a late registration result after the account changes", async () => {
  let finish!: (value: { registered: boolean }) => void;
  backend.registerNative.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderHook(
    ({ user }) => {
      usePushSession(user);
      return usePushState();
    },
    { initialProps: { user: "user-a" } },
  );
  await act(async () => {
    void enablePush("user-a");
  });
  expect(backend.registerNative).toHaveBeenCalledOnce();
  view.rerender({ user: "user-b" });
  await act(async () => {
    finish({ registered: true });
  });
  expect(view.result.current.registered).toBe(false);
  await act(async () => {
    await refreshPushSession("user-a");
  });
  expect(view.result.current.registered).toBe(false);
});

it("catches resume failures and reports an unverified registration", async () => {
  backend.checkPermission.mockRejectedValueOnce(new Error("bridge offline"));
  const { result } = renderHook(() => {
    usePushSession("user-a");
    return usePushState();
  });
  await waitFor(() => expect(result.current.reason).toMatch(/belum dapat diverifikasi/));
  expect(result.current.registered).toBe(false);
});
