import { describe, expect, it } from "vitest";
import { summarizeUnread } from "../unread";

const msg = (id: string, sender: string, created: string, kind = "text") => ({
  id,
  sender_id: sender,
  created_at: created,
  kind,
});

describe("summarizeUnread", () => {
  const list = [
    msg("a", "me", "2026-01-01T00:00:00.000Z"),
    msg("b", "you", "2026-01-01T00:01:00.000Z"),
    msg("c", "you", "2026-01-01T00:02:00.000Z"),
    msg("d", "me", "2026-01-01T00:03:00.000Z"),
    msg("e", "you", "2026-01-01T00:04:00.000Z"),
  ];

  it("menemukan pesan pertama belum dibaca dan jumlahnya", () => {
    const s = summarizeUnread(list, "me", "2026-01-01T00:01:30.000Z");
    expect(s.firstIndex).toBe(2);
    expect(s.firstId).toBe("c");
    expect(s.count).toBe(2);
  });

  it("mengabaikan pesan sendiri dan pesan sistem", () => {
    const s = summarizeUnread(
      [...list, msg("f", "you", "2026-01-01T00:05:00.000Z", "system")],
      "me",
      "2026-01-01T00:04:30.000Z",
    );
    expect(s.count).toBe(0);
    expect(s.firstIndex).toBe(-1);
  });

  it("tanpa baseline semua pesan masuk dihitung", () => {
    expect(summarizeUnread(list, "me", null).count).toBe(3);
  });

  it("aman untuk daftar kosong / tanpa user", () => {
    expect(summarizeUnread([], "me", null).firstIndex).toBe(-1);
    expect(summarizeUnread(list, null, null).count).toBe(0);
  });
});

describe("id pesan belum dibaca", () => {
  it("mengumpulkan semua id untuk sorotan visual", () => {
    const base = "2026-01-01T00:00:00.000Z";
    const s = summarizeUnread(
      [
        { id: "a", sender_id: "other", created_at: "2026-01-01T00:00:01.000Z" },
        { id: "b", sender_id: "me", created_at: "2026-01-01T00:00:02.000Z" },
        { id: "c", sender_id: "other", created_at: "2026-01-01T00:00:03.000Z" },
      ],
      "me",
      base,
    );
    expect(s.ids).toEqual(["a", "c"]);
    expect(s.firstId).toBe("a");
  });
});
