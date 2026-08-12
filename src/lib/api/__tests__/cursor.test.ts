import { describe, expect, it } from "vitest";
import { compareMessages, cursorOf, type MessageRow } from "../chat";

const m = (id: string, created: string) => ({ id, created_at: created }) as MessageRow;

describe("kursor keyset pesan", () => {
  it("kursor memakai pasangan (created_at, id)", () => {
    expect(cursorOf(m("b", "2026-01-01T00:00:00Z"))).toEqual({ createdAt: "2026-01-01T00:00:00Z", id: "b" });
  });

  it("urutan deterministik saat timestamp identik", () => {
    const t = "2026-01-01T00:00:00Z";
    const rows = [m("c", t), m("a", t), m("b", t)].sort(compareMessages);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("halaman lama tidak melewati pesan dengan timestamp sama", () => {
    const t = "2026-01-01T00:00:00Z";
    const all = [m("a", t), m("b", t), m("c", t), m("d", "2025-12-31T23:59:59Z")].sort(compareMessages);
    const page1 = all.slice(-2); // c, b? -> dua terbaru
    const cursor = cursorOf(page1[0]!);
    const older = all.filter(
      (r) => r.created_at < cursor.createdAt || (r.created_at === cursor.createdAt && r.id < cursor.id),
    );
    expect(older.map((r) => r.id)).not.toContain(page1[0]!.id);
    expect(older.length + page1.length).toBe(all.length);
  });
});
