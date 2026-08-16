import { describe, expect, it } from "vitest";
import { keyboardScrollAction } from "../scroll";

describe("keyboardScrollAction", () => {
  it("menempel ke dasar bila pengguna di pesan terbaru", () => {
    expect(keyboardScrollAction({ prevHeight: 800, nextHeight: 480, atBottom: true })).toEqual({
      type: "stick",
    });
  });

  it("tidak menempel bila scroll dikunci", () => {
    expect(
      keyboardScrollAction({ prevHeight: 800, nextHeight: 480, atBottom: true, locked: true }),
    ).toEqual({ type: "adjust", delta: 320 });
  });

  it("mengompensasi keyboard muncul saat membaca riwayat", () => {
    expect(keyboardScrollAction({ prevHeight: 800, nextHeight: 480, atBottom: false })).toEqual({
      type: "adjust",
      delta: 320,
    });
  });

  it("mengompensasi keyboard hilang", () => {
    expect(keyboardScrollAction({ prevHeight: 480, nextHeight: 800, atBottom: false })).toEqual({
      type: "adjust",
      delta: -320,
    });
  });

  it("mengabaikan perubahan kecil seperti bar URL", () => {
    expect(keyboardScrollAction({ prevHeight: 800, nextHeight: 790, atBottom: false })).toEqual({
      type: "none",
    });
  });
});
