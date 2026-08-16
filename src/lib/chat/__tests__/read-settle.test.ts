import { describe, expect, it } from "vitest";
import { advanceReadBaseline, lastVisibleIndex, settledBaseline } from "../read-settle";

const items = [
  { index: 0, start: 0, size: 100 },
  { index: 1, start: 100, size: 100 },
  { index: 2, start: 200, size: 100 },
];

describe("read-settle", () => {
  it("mengambil baris terakhir yang terlihat", () => {
    expect(lastVisibleIndex(items, 0, 150)).toBe(1);
    expect(lastVisibleIndex(items, 100, 200)).toBe(2);
  });
  it("baseline hanya maju", () => {
    expect(advanceReadBaseline("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(
      "2026-01-02T00:00:00Z",
    );
    expect(advanceReadBaseline(null, "2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
    expect(advanceReadBaseline("2026-01-01T00:00:00Z", null)).toBe("2026-01-01T00:00:00Z");
  });
  it("settle memakai waktu pesan terakhir terlihat", () => {
    const msgs = [{ created_at: "2026-01-01T00:00:00Z" }, { created_at: "2026-01-03T00:00:00Z" }];
    expect(settledBaseline(msgs, 1, null)).toBe("2026-01-03T00:00:00Z");
    expect(settledBaseline(msgs, -1, "2026-01-02T00:00:00Z")).toBe("2026-01-02T00:00:00Z");
  });
});
