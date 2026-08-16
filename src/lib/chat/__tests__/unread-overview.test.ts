import { describe, expect, it } from "vitest";
import { overviewUnread } from "../unread-overview";

describe("overviewUnread", () => {
  it("menjumlahkan dan memilih chat paling banyak belum dibaca", () => {
    const r = overviewUnread([
      { id: "a", title_resolved: "A", unread: 2 },
      { id: "b", title_resolved: "B", unread: 5 },
      { id: "c", title_resolved: "C", unread: 0 },
    ]);
    expect(r).toMatchObject({ total: 7, rooms: 2 });
    expect(r.top?.id).toBe("b");
  });
  it("seri dimenangkan pesan terbaru", () => {
    const r = overviewUnread([
      { id: "a", title_resolved: "A", unread: 3, last_message_at: "2026-01-01T00:00:00Z" },
      { id: "b", title_resolved: "B", unread: 3, last_message_at: "2026-02-01T00:00:00Z" },
    ]);
    expect(r.top?.id).toBe("b");
  });
  it("kosong saat semua terbaca", () => {
    expect(overviewUnread([{ id: "a", title_resolved: "A", unread: 0 }])).toEqual({
      total: 0,
      rooms: 0,
      top: null,
    });
  });
});
