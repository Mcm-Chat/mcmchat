import { describe, expect, it } from "vitest";
import { backoffDelay } from "../connection";

describe("backoffDelay", () => {
  it("naik secara eksponensial dan dibatasi 30 detik", () => {
    expect(backoffDelay(0, () => 1)).toBe(1000);
    expect(backoffDelay(1, () => 1)).toBe(2000);
    expect(backoffDelay(20, () => 1)).toBe(30_000);
  });

  it("menambahkan jitter sehingga percobaan tidak serentak", () => {
    expect(backoffDelay(3, () => 0)).toBe(4000);
    expect(backoffDelay(3, () => 1)).toBe(8000);
  });
});
