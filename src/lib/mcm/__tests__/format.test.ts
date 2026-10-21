import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const timeOptions = {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
} satisfies Intl.DateTimeFormatOptions;
const dateOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
} satisfies Intl.DateTimeFormatOptions;
const longDateOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
} satisfies Intl.DateTimeFormatOptions;

describe("shared chat date formatting", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    "2026-10-21T00:00:00.000Z",
    "2026-10-21T16:59:59.999Z",
    "2026-10-21T17:00:00.000Z",
    "2026-12-31T23:59:59.999Z",
    "2024-02-29T10:20:00.000Z",
    "2026-03-08T01:59:00-08:00",
    "2026-11-01T01:59:00-07:00",
    "1970-01-01T00:00:00.000Z",
    "2000-01-01",
    "not-a-date",
    "",
  ])("preserves the existing Indonesian/Jakarta output for %j", async (iso) => {
    const { jam, tanggal, tanggalPanjang } = await import("../format");
    const date = new Date(iso);
    expect(jam(iso)).toBe(date.toLocaleTimeString("id-ID", timeOptions));
    expect(tanggal(iso)).toBe(date.toLocaleDateString("id-ID", dateOptions));
    expect(tanggalPanjang(iso)).toBe(date.toLocaleDateString("id-ID", longDateOptions));
  });

  it("keeps Jakarta midnight independent of the device time zone", async () => {
    const { jam, tanggal } = await import("../format");
    expect(jam("2026-10-21T16:59:00Z")).toBe("23.59");
    expect(jam("2026-10-21T17:00:00Z")).toBe("00.00");
    expect(tanggal("2026-10-21T17:00:00Z")).toBe(tanggal("2026-10-22T12:00:00Z"));
    expect(tanggal("2026-10-21T16:59:00Z")).not.toBe(tanggal("2026-10-21T17:00:00Z"));
  });

  it("does not cache relative day labels across midnight", async () => {
    vi.useFakeTimers();
    const { labelHari, tanggalPanjang, waktuRelatif } = await import("../format");
    // labelHari currently uses the device's day boundary; keep that behavior.
    const today = new Date(2026, 9, 21, 12);
    const yesterday = new Date(today.getTime() - 86_400_000).toISOString();
    const older = new Date(today.getTime() - 3 * 86_400_000).toISOString();
    vi.setSystemTime(today);
    expect(labelHari(today.toISOString())).toBe("Hari ini");
    expect(labelHari(yesterday)).toBe("Kemarin");
    expect(labelHari(older)).toBe(tanggalPanjang(older));
    expect(waktuRelatif("2025-01-01T00:00:00Z")).toBe(
      new Date("2025-01-01T00:00:00Z").toLocaleDateString("id-ID", dateOptions),
    );
    vi.setSystemTime(new Date(today.getTime() + 86_400_000));
    expect(labelHari(today.toISOString())).toBe("Kemarin");
    expect(labelHari(yesterday)).toBe(tanggalPanjang(yesterday));
  });

  it("initializes lazily and constructs only one formatter per format for 1,000 rows", async () => {
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructors = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (locales, options) {
        return new NativeDateTimeFormat(locales, options);
      });
    const { jam, tanggal, tanggalPanjang, labelHari } = await import("../format");
    expect(constructors).not.toHaveBeenCalled();
    expect(jam("not-a-date")).toBe("Invalid Date");
    expect(tanggal("")).toBe("Invalid Date");
    expect(tanggalPanjang("not-a-date")).toBe("Invalid Date");
    expect(constructors).not.toHaveBeenCalled();

    for (let i = 0; i < 1_000; i++) {
      const iso = new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString();
      jam(iso);
      tanggal(iso);
      tanggalPanjang(iso);
      labelHari(iso);
    }
    expect(constructors).toHaveBeenCalledTimes(3);
    expect(constructors).toHaveBeenNthCalledWith(1, "id-ID", timeOptions);
    expect(constructors).toHaveBeenNthCalledWith(2, "id-ID", dateOptions);
    expect(constructors).toHaveBeenNthCalledWith(3, "id-ID", longDateOptions);
  });

  it("preserves rupiah rounding, special values, and short labels", async () => {
    const { rupiah, rupiahShort } = await import("../format");
    const previous = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    });
    for (const value of [0, -0, 0.5, -0.5, 999.9, -1_234.56, 1e9, NaN, Infinity, -Infinity]) {
      expect(rupiah(value)).toBe(previous.format(Math.round(value)));
    }
    expect(rupiahShort(999)).toBe(rupiah(999));
    expect(rupiahShort(1_000)).toBe("Rp 1 rb");
    expect(rupiahShort(1_500_000)).toBe("Rp 1,5 jt");
    expect(rupiahShort(-1_500_000)).toBe("Rp -1,5 jt");
  });

  it("reuses one lazily initialized rupiah formatter for 1,000 values", async () => {
    const NativeNumberFormat = Intl.NumberFormat;
    const constructors = vi
      .spyOn(Intl, "NumberFormat")
      .mockImplementation(function (locales, options) {
        return new NativeNumberFormat(locales, options);
      });
    const { rupiah } = await import("../format");
    expect(constructors).not.toHaveBeenCalled();
    for (let i = 0; i < 1_000; i++) rupiah(i * 1_234.56);
    expect(constructors).toHaveBeenCalledTimes(1);
    expect(constructors).toHaveBeenCalledWith("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    });
  });
});
