import { describe, expect, it } from "vitest";
import { groupKeyFromPush, routeFromPush } from "@/lib/push/deeplink";

describe("deep link panggilan", () => {
  it("membuka layar panggilan dari notifikasi panggilan", () => {
    expect(routeFromPush({ kind: "call", callId: "abc" })).toBe("/call/abc");
  });

  it("jatuh ke riwayat bila id panggilan hilang", () => {
    expect(routeFromPush({ kind: "call" })).toBe("/calls");
  });

  it("mengelompokkan notifikasi per panggilan", () => {
    expect(groupKeyFromPush({ kind: "call", callId: "abc" })).toBe("abc");
  });
});
