import { describe, expect, it, vi } from "vitest";
import { retryRouteLoad, type RecoveryStage } from "@/lib/chunk-recovery";

describe("retryRouteLoad", () => {
  it("prefetch ulang rute target lalu menyegarkan data", async () => {
    const stages: RecoveryStage[] = [];
    const preloadRoute = vi.fn().mockResolvedValue(undefined);
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const ok = await retryRouteLoad({ preloadRoute, invalidate }, "/catalog", (s) =>
      stages.push(s),
    );
    expect(ok).toBe(true);
    expect(preloadRoute).toHaveBeenCalledWith({ to: "/catalog" });
    expect(invalidate).toHaveBeenCalled();
    expect(stages).toEqual(["membersihkan", "mengunduh", "menampilkan"]);
  });

  it("jatuh ke muat ulang penuh bila prefetch tetap gagal", async () => {
    const stages: RecoveryStage[] = [];
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      writable: true,
    });
    const ok = await retryRouteLoad(
      { preloadRoute: vi.fn().mockRejectedValue(new Error("boom")), invalidate: vi.fn() },
      "/catalog",
      (s) => stages.push(s),
    );
    expect(ok).toBe(false);
    expect(stages.at(-1)).toBe("gagal");
    expect(reload).toHaveBeenCalled();
  });
});
