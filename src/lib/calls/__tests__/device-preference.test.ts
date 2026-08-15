import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreferredDevices,
  readPreferredDevice,
  resolvePreferredDevice,
  writePreferredDevice,
} from "../device-preference";

describe("device-preference", () => {
  beforeEach(() => clearPreferredDevices());

  it("mengingat pilihan terakhir", () => {
    writePreferredDevice("mic", "mic-1");
    expect(readPreferredDevice("mic")).toBe("mic-1");
    expect(readPreferredDevice("camera")).toBeNull();
  });

  it("abai pada nilai kosong", () => {
    writePreferredDevice("camera", null);
    expect(readPreferredDevice("camera")).toBeNull();
  });

  it("hanya memakai perangkat yang tersedia", () => {
    writePreferredDevice("camera", "cam-9");
    expect(resolvePreferredDevice("camera", [{ deviceId: "cam-1" }])).toBeNull();
    expect(resolvePreferredDevice("camera", [{ deviceId: "cam-9" }])).toBe("cam-9");
  });
});
