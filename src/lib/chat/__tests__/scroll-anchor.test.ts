import { describe, expect, it } from "vitest";
import { anchorScrollDelta, pickScrollAnchor } from "../scroll";

const items = [
  { index: 0, start: 0, end: 100 },
  { index: 1, start: 100, end: 240 },
  { index: 2, start: 240, end: 300 },
];

describe("jangkar scroll", () => {
  it("memilih baris pertama yang masih terlihat", () => {
    expect(pickScrollAnchor(items, 120)).toEqual({ index: 1, start: 100 });
  });

  it("jatuh ke baris terakhir bila scroll melewati semua item", () => {
    expect(pickScrollAnchor(items, 999)).toEqual({ index: 2, start: 240 });
  });

  it("null bila tidak ada item", () => {
    expect(pickScrollAnchor([], 0)).toBeNull();
  });

  it("menghitung koreksi saat baris di atas membesar", () => {
    expect(anchorScrollDelta({ index: 1, start: 100 }, 260)).toBe(160);
  });

  it("mengabaikan perubahan sub-piksel dan pengukuran kosong", () => {
    expect(anchorScrollDelta({ index: 1, start: 100 }, 100.4)).toBe(0);
    expect(anchorScrollDelta({ index: 1, start: 100 }, undefined)).toBe(0);
  });
});
