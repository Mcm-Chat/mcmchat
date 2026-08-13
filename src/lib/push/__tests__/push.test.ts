import { describe, expect, it } from "vitest";
import { GENERIC_BODY, notificationTitle, previewBody, CHANNELS } from "../payload";
import { groupKeyFromPush, routeFromPush } from "../deeplink";

describe("previewBody", () => {
  it("menyembunyikan isi pesan saat pratinjau dimatikan", () => {
    expect(previewBody("text", "Transfer 5 juta ke rekening", false)).toBe(GENERIC_BODY);
    expect(previewBody("image", "rahasia", false)).toBe(GENERIC_BODY);
  });

  it("meringkas jenis lampiran tanpa membocorkan isi", () => {
    expect(previewBody("image", "apa pun", true)).toBe("📷 Foto");
    expect(previewBody("voice", "", true)).toBe("🎤 Pesan suara");
  });

  it("memotong teks panjang", () => {
    const long = "a".repeat(300);
    const out = previewBody("text", long, true);
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("notificationTitle", () => {
  it("memakai MCM saat pratinjau dimatikan", () => {
    expect(notificationTitle("Budi Santoso", false)).toBe("MCM");
    expect(notificationTitle("Budi Santoso", true)).toBe("Budi Santoso");
  });
});

describe("routeFromPush", () => {
  it("membuka pesan tepat di percakapan", () => {
    expect(routeFromPush({ kind: "message", conversationId: "c1", messageId: "m1" })).toBe(
      "/chat/c1?m=m1",
    );
  });

  it("menolak rute absolut/eksternal", () => {
    expect(routeFromPush({ kind: "message", route: "//evil.com", conversationId: "c1" })).toBe(
      "/chat/c1",
    );
  });

  it("punya fallback aman", () => {
    expect(routeFromPush(null)).toBe("/chat");
    expect(routeFromPush({ kind: "task_assigned" })).toBe("/tasks");
    expect(routeFromPush({ kind: "ledger", ledgerId: "l1" })).toBe("/ledger/l1");
  });
});

describe("grup & channel", () => {
  it("mengelompokkan per percakapan", () => {
    expect(groupKeyFromPush({ conversationId: "c9" })).toBe("c9");
    expect(groupKeyFromPush({})).toBe("mcm");
  });

  it("panggilan memakai importance tertinggi", () => {
    expect(CHANNELS.calls.importance).toBeGreaterThan(CHANNELS.messages.importance);
  });
});
