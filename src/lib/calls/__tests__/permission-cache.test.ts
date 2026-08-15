import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCachedPermission,
  readCachedPermission,
  writeCachedPermission,
} from "../permission-cache";

describe("permission-cache", () => {
  beforeEach(() => {
    clearCachedPermission();
    vi.useRealTimers();
  });

  it("mengingat izin terakhir per jenis panggilan", () => {
    writeCachedPermission("audio", "granted");
    writeCachedPermission("video", "denied");
    expect(readCachedPermission("audio")).toBe("granted");
    expect(readCachedPermission("video")).toBe("denied");
  });

  it("tidak menyimpan status sementara 'checking'", () => {
    writeCachedPermission("audio", "checking");
    expect(readCachedPermission("audio")).toBeNull();
  });

  it("mengabaikan ingatan yang sudah kadaluarsa", () => {
    writeCachedPermission("audio", "granted");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(readCachedPermission("audio")).toBeNull();
  });

  it("bertahan terhadap isi localStorage yang rusak", () => {
    window.localStorage.setItem("mcm.media-permission.v1", "{bukan json");
    expect(readCachedPermission("audio")).toBeNull();
    writeCachedPermission("audio", "audio_only");
    expect(readCachedPermission("audio")).toBe("audio_only");
  });
});
