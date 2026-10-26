import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettingsRow } from "@/lib/api/settings";
const api = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn() }));
vi.mock("@/lib/api/settings", () => api);
import { useUserSettings } from "../use-settings";
const row = (userId: string, theme = "dark"): UserSettingsRow => ({
  user_id: userId,
  theme,
  notifications: {},
  privacy: {},
  security: {},
  voice: {},
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("account settings synchronization", () => {
  it("shows a load failure and allows an explicit retry", async () => {
    api.getSettings
      .mockRejectedValueOnce(new Error("Koneksi bermasalah"))
      .mockResolvedValueOnce(row("retry"));
    const view = renderHook(() => useUserSettings("retry"));
    await waitFor(() => expect(view.result.current.error).toBe("Koneksi bermasalah"));
    expect(view.result.current.settings).toBeNull();
    await act(() => view.result.current.refresh());
    expect(view.result.current.settings?.user_id).toBe("retry");
    expect(view.result.current.error).toBeNull();
  });
  it("coalesces reads and applies a saved row to every mounted consumer", async () => {
    api.getSettings.mockResolvedValue(row("shared"));
    api.updateSettings.mockResolvedValue(row("shared", "light"));
    const a = renderHook(() => useUserSettings("shared"));
    const b = renderHook(() => useUserSettings("shared"));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    await act(() => a.result.current.patch({ theme: "light" }));
    expect(a.result.current.settings?.theme).toBe("light");
    expect(b.result.current.settings?.theme).toBe("light");
  });
  it("ignores an old account's pending load after switching accounts", async () => {
    const pending = deferred<UserSettingsRow>();
    api.getSettings.mockImplementation((id: string) =>
      id === "old" ? pending.promise : Promise.resolve(row(id, "light")),
    );
    const view = renderHook(({ id }) => useUserSettings(id), { initialProps: { id: "old" } });
    view.rerender({ id: "new" });
    expect(view.result.current.settings).toBeNull();
    await waitFor(() => expect(view.result.current.settings?.user_id).toBe("new"));
    await act(async () => {
      pending.resolve(row("old"));
      await pending.promise;
    });
    expect(view.result.current.settings?.user_id).toBe("new");
  });
  it("does not let a pre-save refresh overwrite a successfully saved preference", async () => {
    const pending = deferred<UserSettingsRow>();
    api.getSettings.mockResolvedValueOnce(row("stale")).mockReturnValueOnce(pending.promise);
    api.updateSettings.mockResolvedValue(row("stale", "light"));
    const view = renderHook(() => useUserSettings("stale"));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let refresh!: Promise<void>;
    act(() => {
      refresh = view.result.current.refresh();
    });
    await act(() => view.result.current.patch({ theme: "light" }));
    await act(async () => {
      pending.resolve(row("stale"));
      await refresh;
    });
    expect(view.result.current.settings?.theme).toBe("light");
  });
  it("serializes writes from separate controls so late responses cannot undo a newer save", async () => {
    api.getSettings.mockResolvedValue(row("queue"));
    const first = deferred<UserSettingsRow>();
    api.updateSettings
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(row("queue", "light"));
    const a = renderHook(() => useUserSettings("queue"));
    const b = renderHook(() => useUserSettings("queue"));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    let saveA!: Promise<UserSettingsRow>;
    let saveB!: Promise<UserSettingsRow>;
    act(() => {
      saveA = a.result.current.patch({ notifications: { sound: false } });
      saveB = b.result.current.patch({ theme: "light" });
    });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    expect(b.result.current.saving).toBe(true);
    await act(async () => {
      first.resolve(row("queue"));
      await Promise.all([saveA, saveB]);
    });
    expect(api.updateSettings).toHaveBeenCalledTimes(2);
    expect(a.result.current.settings?.theme).toBe("light");
    expect(b.result.current.settings?.theme).toBe("light");
    expect(b.result.current.saving).toBe(false);
  });
  it("does not replace saved settings when a save fails", async () => {
    api.getSettings.mockResolvedValue(row("failed"));
    api.updateSettings.mockRejectedValue(new Error("Gagal menyimpan"));
    const view = renderHook(() => useUserSettings("failed"));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => {
      await expect(view.result.current.patch({ theme: "light" })).rejects.toThrow(
        "Gagal menyimpan",
      );
    });
    expect(view.result.current.settings?.theme).toBe("dark");
    expect(view.result.current.saving).toBe(false);
  });
  it("accepts a waiting consumer's load when another consumer's pending write fails", async () => {
    api.getSettings.mockResolvedValue(row("failed-write-reader"));
    const pending = deferred<UserSettingsRow>();
    api.updateSettings.mockReturnValue(pending.promise);
    const a = renderHook(() => useUserSettings("failed-write-reader"));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    let failure!: Promise<unknown>;
    act(() => {
      failure = a.result.current.patch({ theme: "light" }).catch((error: unknown) => error);
    });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
    const b = renderHook(() => useUserSettings("failed-write-reader"));
    expect(b.result.current.loading).toBe(true);
    await act(async () => {
      pending.reject(new Error("Server tidak dapat dihubungi"));
      await failure;
    });
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current.settings?.theme).toBe("dark");
  });
  it("refreshes other-device settings when the app regains focus", async () => {
    api.getSettings
      .mockResolvedValueOnce(row("focus"))
      .mockResolvedValueOnce(row("focus", "light"));
    const view = renderHook(() => useUserSettings("focus"));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(view.result.current.settings?.theme).toBe("light"));
  });
  it("refreshes visible settings every 30 seconds and pauses while offline", async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    api.getSettings.mockResolvedValueOnce(row("timer")).mockResolvedValue(row("timer", "light"));
    const view = renderHook(() => useUserSettings("timer"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.loading).toBe(false);
    online.mockReturnValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    online.mockReturnValue(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect(view.result.current.settings?.theme).toBe("light");
    online.mockRestore();
  });
  it("ignores an old account's in-flight save after the screen changes accounts", async () => {
    api.getSettings.mockImplementation((id: string) => Promise.resolve(row(id)));
    const pending = deferred<UserSettingsRow>();
    api.updateSettings.mockReturnValue(pending.promise);
    const view = renderHook(({ id }) => useUserSettings(id), { initialProps: { id: "save-old" } });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let failure!: Promise<unknown>;
    act(() => {
      failure = view.result.current.patch({ theme: "light" }).catch((error: unknown) => error);
    });
    view.rerender({ id: "save-new" });
    await waitFor(() => expect(view.result.current.settings?.user_id).toBe("save-new"));
    await act(async () => {
      pending.resolve(row("save-old", "light"));
      await failure;
    });
    expect(await failure).toBeInstanceOf(Error);
    expect(view.result.current.settings?.user_id).toBe("save-new");
    expect(view.result.current.settings?.theme).toBe("dark");
  });
});
