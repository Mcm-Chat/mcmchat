import { describe, expect, it } from "vitest";
import { isKeyboardOpen, keyboardInset } from "../viewport";
import { BACK_GUARD_KEY, isGuardState } from "../back-guard";

describe("keyboardInset", () => {
  it("nol saat WebView ikut resize (adjustResize)", () => {
    expect(keyboardInset({ innerHeight: 480, visualHeight: 480, offsetTop: 0 })).toBe(0);
  });

  it("mengabaikan selisih kecil (bilah URL/pembulatan)", () => {
    expect(keyboardInset({ innerHeight: 800, visualHeight: 760, offsetTop: 0 })).toBe(0);
  });

  it("mengukur keyboard saat viewport hanya menyusut secara visual", () => {
    const sample = { innerHeight: 800, visualHeight: 460, offsetTop: 0 };
    expect(keyboardInset(sample)).toBe(340);
    expect(isKeyboardOpen(sample)).toBe(true);
  });

  it("memperhitungkan offsetTop saat viewport digeser", () => {
    expect(keyboardInset({ innerHeight: 800, visualHeight: 460, offsetTop: 340 })).toBe(0);
  });

  it("aman terhadap nilai tidak valid", () => {
    expect(keyboardInset({ innerHeight: NaN, visualHeight: 100, offsetTop: 0 })).toBe(0);
  });
});

describe("isGuardState", () => {
  it("hanya mengenali entri penanda overlay", () => {
    expect(isGuardState({ [BACK_GUARD_KEY]: true })).toBe(true);
    expect(isGuardState({ other: 1 })).toBe(false);
    expect(isGuardState(null)).toBe(false);
  });
});
