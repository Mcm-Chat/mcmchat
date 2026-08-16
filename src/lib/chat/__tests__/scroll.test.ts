import { describe, expect, it } from "vitest";
import { isNearBottom, shouldAutoScroll } from "../scroll";

describe("isNearBottom", () => {
  it("true saat pengguna berada di dasar daftar", () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })).toBe(true);
  });
  it("false saat pengguna sedang membaca riwayat lama", () => {
    expect(isNearBottom({ scrollHeight: 5000, scrollTop: 200, clientHeight: 800 })).toBe(false);
  });
});

describe("shouldAutoScroll", () => {
  it("selalu turun bila sudah di dasar", () => {
    expect(shouldAutoScroll({ atBottom: true, lastSenderId: "b", userId: "a" })).toBe(true);
  });
  it("turun bila pesan terakhir milik sendiri walau sedang di atas", () => {
    expect(shouldAutoScroll({ atBottom: false, lastSenderId: "a", userId: "a" })).toBe(true);
  });
  it("mempertahankan posisi saat pesan orang lain masuk", () => {
    expect(shouldAutoScroll({ atBottom: false, lastSenderId: "b", userId: "a" })).toBe(false);
  });
  it("aman saat pengguna belum dikenal", () => {
    expect(shouldAutoScroll({ atBottom: false, lastSenderId: null, userId: undefined })).toBe(
      false,
    );
  });
});

import { isUserScrolling, USER_SCROLL_GRACE_MS } from "../scroll";

describe("auto-scroll cerdas", () => {
  it("tidak loncat saat pengguna masih menggulir", () => {
    expect(shouldAutoScroll({ atBottom: true, lastSenderId: "b", userId: "a", userScrolling: true })).toBe(false);
  });
  it("tetap turun untuk pesan sendiri meski sedang menggulir", () => {
    expect(shouldAutoScroll({ atBottom: false, lastSenderId: "a", userId: "a", userScrolling: true })).toBe(true);
  });
  it("masa tenggang interaksi berakhir", () => {
    const t = 1_000_000;
    expect(isUserScrolling(t, t + 100)).toBe(true);
    expect(isUserScrolling(t, t + USER_SCROLL_GRACE_MS + 1)).toBe(false);
  });
});
