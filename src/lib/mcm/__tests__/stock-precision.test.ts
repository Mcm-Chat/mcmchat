import { describe, expect, it } from "vitest";
import {
  MIN_WEIGHT_GRAM,
  parseDecimalId,
  toGrams,
  toNumericString,
  validateVariantDraft,
} from "@/lib/mcm/decimal";
import { extractCoords, sanitizeMapsUrl } from "@/lib/mcm/geo";
import { friendly } from "@/lib/api/db";

describe("parser desimal Indonesia", () => {
  it("menerima koma sebagai pemisah desimal", () => {
    expect(parseDecimalId("0,01")).toBe(0.01);
    expect(parseDecimalId("1.250,5")).toBe(1250.5);
  });
  it("menolak input tidak valid", () => {
    expect(parseDecimalId("abc")).toBeNull();
    expect(parseDecimalId("")).toBeNull();
  });
  it("mempertahankan presisi 6 desimal saat serialisasi", () => {
    expect(Number(toNumericString(0.01))).toBe(0.01);
    expect(Number(toNumericString(0.000001))).toBe(0.000001);
  });
});

describe("varian stok berat", () => {
  const base = { name: "Emas", price: "100000", display_unit: "g" };
  it("menerima 0,01 g tanpa error smallint", () => {
    const r = validateVariantDraft({
      ...base,
      stock_kind: "weight",
      display_quantity: "0,01",
    } as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.base_quantity_grams).toBeCloseTo(MIN_WEIGHT_GRAM, 6);
  });
  it("mengonversi kg ke gram", () => {
    expect(toGrams(1.5, "kg")).toBe(1500);
  });
  it("menolak satuan hitungan pada model berat", () => {
    const r = validateVariantDraft({
      ...base,
      stock_kind: "weight",
      display_unit: "pcs",
      display_quantity: "1",
    } as never);
    expect(r.ok).toBe(false);
  });
});

describe("varian stok hitungan", () => {
  it("menolak isi per satuan desimal", () => {
    const r = validateVariantDraft({
      name: "Botol",
      price: "5000",
      display_unit: "karton",
      stock_kind: "count",
      units_per_display: "12,5",
    } as never);
    expect(r.ok).toBe(false);
  });
  it("menerima bilangan bulat", () => {
    const r = validateVariantDraft({
      name: "Botol",
      price: "5000",
      display_unit: "karton",
      stock_kind: "count",
      units_per_display: "12",
    } as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.units_per_display).toBe(12);
  });
});

describe("sanitasi link lokasi", () => {
  it("menolak skema berbahaya", () => {
    expect(sanitizeMapsUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeMapsUrl("http://maps.google.com")).toBeNull();
  });
  it("menerima https dan membaca koordinat", () => {
    const u = "https://www.google.com/maps?q=-6.2,106.8";
    expect(sanitizeMapsUrl(u)).toBe(u);
    expect(extractCoords(u)).toEqual({ lat: -6.2, lng: 106.8 });
  });
  it("string kosong berarti tanpa lokasi", () => {
    expect(sanitizeMapsUrl("  ")).toBe("");
  });
});

describe("pesan error ramah pengguna", () => {
  it("tidak membocorkan sintaks Postgres", () => {
    const msg = friendly('invalid input syntax for type smallint: "0.01"', "Gagal");
    expect(msg).not.toContain("smallint");
    expect(msg).not.toContain("invalid input");
  });
  it("memetakan pelanggaran RLS", () => {
    expect(friendly("new row violates row-level security policy", "Gagal")).toContain("akses");
  });
});
