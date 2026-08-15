/**
 * Parser/formatter angka terpusat untuk MCM.
 *
 * Semua input numerik pengguna Indonesia boleh memakai koma desimal dan titik
 * ribuan. Nilai desimal yang dikirim ke Supabase dinormalisasi menjadi string
 * agar presisi NUMERIC tidak hilang oleh pembulatan floating point.
 */

/** Satuan berat yang didukung dan faktornya terhadap gram. */
export const WEIGHT_UNIT_TO_GRAM = {
  mg: 0.001,
  g: 1,
  ons: 100,
  kg: 1000,
} as const;

export type WeightUnit = keyof typeof WEIGHT_UNIT_TO_GRAM;
export const WEIGHT_UNIT_LIST = Object.keys(WEIGHT_UNIT_TO_GRAM) as WeightUnit[];

/** Satuan hitungan yang didukung (tidak pernah dikonversi ke gram). */
export const COUNT_UNIT_LIST = ["pcs", "botol", "karton", "koli", "dus", "sak"] as const;
export type CountUnit = (typeof COUNT_UNIT_LIST)[number];
export const COUNT_BASE_UNITS = ["pcs", "botol"] as const;

/**
 * Berat terkecil yang boleh disimpan: 0,0001 g (0,1 mg).
 * Satuan tampilan `mg` didukung, jadi batas lama 0,01 g memblokir varian
 * berskala miligram (mis. 0,2 mg) padahal presisi NUMERIC mencukupi.
 */
export const MIN_WEIGHT_GRAM = 0.0001;
const DECIMAL_SCALE = 6;

export function isWeightUnit(u: string): u is WeightUnit {
  return (WEIGHT_UNIT_LIST as string[]).includes(u.toLowerCase());
}
export function isCountUnit(u: string): u is CountUnit {
  return (COUNT_UNIT_LIST as readonly string[]).includes(u.toLowerCase());
}

/**
 * Ubah teks angka gaya Indonesia ("1.234,56" / "0,01" / "0.01") menjadi number.
 * Mengembalikan null bila bukan angka valid.
 */
export function parseDecimalId(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  if (!/^-?[\d.,\s]+$/.test(s)) return null;
  const cleaned = s.replace(/\s/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Pemisah desimal adalah yang muncul paling akhir.
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    const frac = cleaned.length - lastDot - 1;
    const dots = (cleaned.match(/\./g) ?? []).length;
    // "100.000" -> ribuan; "0.01" -> desimal.
    normalized = dots > 1 || frac === 3 ? cleaned.replace(/\./g, "") : cleaned;
  } else {
    normalized = cleaned;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Parser khusus Rupiah: "Rp 100.000" -> 100000. */
export function parseRupiah(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  return parseDecimalId(String(raw ?? "").replace(/rp/gi, ""));
}

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDecimalId(value: number, maxFrac = 6): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxFrac }).format(value);
}

/** Normalisasi angka desimal menjadi string aman untuk kolom NUMERIC. */
export function toNumericString(value: number, scale = DECIMAL_SCALE): string {
  if (!Number.isFinite(value)) throw new Error("Nilai desimal tidak valid");
  const fixed = value.toFixed(scale);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/** Perkalian desimal bebas galat float (0.1 * 3 === 0.3). */
export function decimalMultiply(a: number, b: number, scale = DECIMAL_SCALE): number {
  return Number((a * b).toFixed(scale));
}

/** Konversi jumlah + satuan berat menjadi gram, presisi 6 desimal. */
export function toGrams(qty: number, unit: string): number {
  const u = unit.toLowerCase();
  if (!isWeightUnit(u)) throw new Error("Satuan tidak sesuai dengan jenis stok.");
  return decimalMultiply(qty, WEIGHT_UNIT_TO_GRAM[u]);
}

/** Konversi gram kembali ke satuan tampilan. */
export function fromGrams(grams: number, unit: string): number {
  const u = unit.toLowerCase();
  if (!isWeightUnit(u)) throw new Error("Satuan tidak sesuai dengan jenis stok.");
  return Number((grams / WEIGHT_UNIT_TO_GRAM[u]).toFixed(DECIMAL_SCALE));
}

// ---------------------------------------------------------------------------
// Validasi varian (dipakai form dan lapisan API sebelum menyentuh Supabase)
// ---------------------------------------------------------------------------

export type VariantDraft = {
  name: string;
  stock_kind: "weight" | "count";
  display_unit: string;
  base_unit?: string;
  /** weight: jumlah berat pada satuan tampilan. */
  display_quantity?: string | number | null;
  /** count: isi per satuan tampilan (bilangan bulat). */
  units_per_display?: string | number | null;
  price: string | number | null;
  quantity_precision?: string | number | null;
};

export type VariantValidation =
  | {
      ok: true;
      value: {
        name: string;
        stock_kind: "weight" | "count";
        display_unit: string;
        base_unit: string;
        base_quantity_grams: number | null;
        units_per_display: number | null;
        quantity_precision: number;
        price: number;
      };
    }
  | { ok: false; field: string; message: string };

export const VARIANT_MESSAGES = {
  name: "Nama varian wajib diisi.",
  invalidDecimal: "Jumlah berat harus berupa angka desimal yang valid.",
  minWeight: "Berat minimum adalah 0,0001 gram (0,1 mg).",
  invalidUnits: "Isi per satuan harus bilangan bulat lebih dari nol.",
  price: "Harga varian wajib diisi.",
  unit: "Satuan tidak sesuai dengan jenis stok.",
  duplicate: "Varian dengan nama tersebut sudah tersedia.",
} as const;

export function validateVariantDraft(draft: VariantDraft): VariantValidation {
  const name = draft.name.trim();
  if (name.length < 1) return { ok: false, field: "name", message: VARIANT_MESSAGES.name };

  const price = parseRupiah(draft.price);
  if (price === null || price < 0) {
    return { ok: false, field: "price", message: VARIANT_MESSAGES.price };
  }

  const unit = draft.display_unit.trim().toLowerCase();

  if (draft.stock_kind === "weight") {
    if (!isWeightUnit(unit))
      return { ok: false, field: "display_unit", message: VARIANT_MESSAGES.unit };
    const qty = parseDecimalId(draft.display_quantity ?? null);
    if (qty === null) {
      return { ok: false, field: "display_quantity", message: VARIANT_MESSAGES.invalidDecimal };
    }
    const grams = toGrams(qty, unit);
    if (!(grams >= MIN_WEIGHT_GRAM)) {
      return { ok: false, field: "display_quantity", message: VARIANT_MESSAGES.minWeight };
    }
    const precision = parseDecimalId(draft.quantity_precision ?? MIN_WEIGHT_GRAM);
    return {
      ok: true,
      value: {
        name,
        stock_kind: "weight",
        display_unit: unit,
        base_unit: "g",
        base_quantity_grams: grams,
        units_per_display: null,
        quantity_precision: precision && precision > 0 ? precision : MIN_WEIGHT_GRAM,
        price,
      },
    };
  }

  if (!isCountUnit(unit))
    return { ok: false, field: "display_unit", message: VARIANT_MESSAGES.unit };
  const per = parseDecimalId(draft.units_per_display ?? null);
  if (per === null || !Number.isInteger(per) || per <= 0) {
    return { ok: false, field: "units_per_display", message: VARIANT_MESSAGES.invalidUnits };
  }
  const base = (draft.base_unit ?? "").toLowerCase();
  const baseUnit = (COUNT_BASE_UNITS as readonly string[]).includes(base)
    ? base
    : unit === "botol" || unit === "karton" || unit === "koli"
      ? "botol"
      : "pcs";
  return {
    ok: true,
    value: {
      name,
      stock_kind: "count",
      display_unit: unit,
      base_unit: baseUnit,
      base_quantity_grams: null,
      units_per_display: per,
      quantity_precision: 1,
      price,
    },
  };
}
