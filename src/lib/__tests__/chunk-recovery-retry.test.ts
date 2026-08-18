import { describe, expect, it, vi } from "vitest";
import {
  isChunkLoadError,
  retryRouteLoad,
  retryRouteRender,
  type RecoveryStage,
} from "@/lib/chunk-recovery";

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
    expect(stages).toEqual(["mencoba", "mengunduh", "menampilkan"]);
  });

  it("retry render biasa tidak melakukan preload atau reload", async () => {
    const stages: RecoveryStage[] = [];
    const reset = vi.fn();
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const ok = await retryRouteRender({ invalidate }, reset, (stage) => stages.push(stage));

    expect(ok).toBe(true);
    expect(reset).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(stages).toEqual(["mencoba", "menampilkan"]);
  });

  it("mengenali variasi error aset Android tanpa menangkap fetch API biasa", () => {
    expect(isChunkLoadError(new TypeError("Module script load failed"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Load failed: /assets/chat-D4X9.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch"))).toBe(false);
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

describe("isDomMutationError", () => {
  it("mengenali kegagalan removeChild dari React", () => {
    const e = new Error(
      "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    );
    e.name = "NotFoundError";
    expect(isDomMutationError(e)).toBe(true);
  });

  it("tidak menangkap NotFoundError perangkat media", () => {
    const e = new Error("Requested device not found");
    e.name = "NotFoundError";
    expect(isDomMutationError(e)).toBe(false);
  });
});
