import { describe, expect, it } from "vitest";
import { ApiError, classifyFailure } from "../errors";

describe("classifyFailure", () => {
  it("unique violation dikenali sebagai duplikat lewat SQLSTATE, bukan teks", () => {
    expect(classifyFailure({ code: "23505", message: "whatever locale" })).toBe("duplicate");
  });

  it("izin ditolak bersifat permanen", () => {
    expect(classifyFailure({ code: "42501", message: "x" })).toBe("permanent");
    expect(classifyFailure({ status: 403, message: "x" })).toBe("permanent");
  });

  it("validasi/foreign key bersifat permanen", () => {
    expect(classifyFailure({ code: "23503", message: "x" })).toBe("permanent");
    expect(classifyFailure({ code: "23502", message: "x" })).toBe("permanent");
  });

  it("jaringan/5xx/429 layak dicoba ulang", () => {
    expect(classifyFailure(new Error("Failed to fetch"))).toBe("transient");
    expect(classifyFailure({ status: 503, message: "x" })).toBe("transient");
    expect(classifyFailure({ status: 429, message: "x" })).toBe("transient");
    expect(classifyFailure({ code: "40001", message: "x" })).toBe("transient");
  });

  it("ApiError mempertahankan klasifikasi aslinya", () => {
    const e = new ApiError("Anda tidak memiliki akses", { code: "42501" });
    expect(e.kind).toBe("permanent");
    expect(classifyFailure(e)).toBe("permanent");
  });
});
