import { describe, expect, it } from "vitest";
import {
  advance,
  clampSlideMs,
  expiresAtFrom,
  firstUnseenIndex,
  groupFeed,
  sisaWaktu,
  type StatusFeedRow,
  type StatusItem,
} from "../model";
import { canRedo, canUndo, editorReducer, initialEditor } from "../editor";

const item = (id: string, status: string, owner: string, order = 0): StatusItem => ({
  id,
  status_id: status,
  owner_id: owner,
  kind: "text",
  media_path: null,
  thumb_path: null,
  duration_ms: 5000,
  sort_order: order,
  caption: "",
  text_meta: {},
  created_at: `2026-01-0${order + 1}T00:00:00Z`,
});

const row = (status: string, owner: string, unseen: number, last: string): StatusFeedRow => ({
  status_id: status,
  owner_id: owner,
  caption: "",
  privacy: "contacts",
  created_at: last,
  expires_at: "2999-01-01T00:00:00Z",
  last_item_at: last,
  item_count: 1,
  unseen_count: unseen,
  muted: false,
});

describe("model status", () => {
  it("membatasi durasi slide", () => {
    expect(clampSlideMs(10)).toBe(1000);
    expect(clampSlideMs(999999)).toBe(30000);
    expect(clampSlideMs(7000)).toBe(7000);
  });

  it("menghitung masa aktif", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(expiresAtFrom(60, now)).toBe("2026-01-01T01:00:00.000Z");
    expect(sisaWaktu("2026-01-01T03:00:00Z", now)).toBe("3 jam lagi");
    expect(sisaWaktu("2025-12-31T23:00:00Z", now)).toBe("Kedaluwarsa");
  });

  it("mengelompokkan feed: milik saya dulu, lalu yang belum dilihat", () => {
    const rows = [row("s1", "me", 0, "2026-01-01T00:00:00Z"), row("s2", "a", 1, "2026-01-02T00:00:00Z"), row("s3", "b", 0, "2026-01-03T00:00:00Z")];
    const items = [item("i1", "s1", "me"), item("i2", "s2", "a"), item("i3", "s3", "b")];
    const groups = groupFeed(rows, items, {}, "me", new Set(["i3"]));
    expect(groups.map((g) => g.ownerId)).toEqual(["me", "a", "b"]);
    expect(groups[1]!.unseen).toBe(1);
    expect(groups[2]!.unseen).toBe(0);
  });

  it("membuka slide pertama yang belum dilihat", () => {
    const items = [item("a", "s", "u", 0), item("b", "s", "u", 1), item("c", "s", "u", 2)];
    expect(firstUnseenIndex(items, new Set(["a", "b"]))).toBe(2);
    expect(firstUnseenIndex(items, new Set(["a", "b", "c"]))).toBe(0);
  });

  it("navigasi lintas grup dan menutup di ujung", () => {
    const groups = [{ items: [1, 2] }, { items: [3] }];
    expect(advance(groups, 0, 0, 1)).toEqual({ groupIndex: 0, itemIndex: 1, done: false });
    expect(advance(groups, 0, 1, 1)).toEqual({ groupIndex: 1, itemIndex: 0, done: false });
    expect(advance(groups, 1, 0, 1).done).toBe(true);
    expect(advance(groups, 1, 0, -1)).toEqual({ groupIndex: 0, itemIndex: 1, done: false });
  });
});

describe("editor status", () => {
  it("undo/redo menjaga riwayat", () => {
    let s = initialEditor;
    expect(canUndo(s)).toBe(false);
    s = editorReducer(s, { type: "filter", filter: "mono" });
    expect(s.filter).toBe("mono");
    s = editorReducer(s, { type: "undo" });
    expect(s.filter).toBe("none");
    expect(canRedo(s)).toBe(true);
    s = editorReducer(s, { type: "redo" });
    expect(s.filter).toBe("mono");
  });

  it("satu goresan hanya menghasilkan satu langkah undo", () => {
    let s = editorReducer(initialEditor, {
      type: "add",
      layer: { id: "x", type: "stroke", tool: "pen", color: "#fff", width: 10, points: [{ x: 0, y: 0 }] },
    });
    s = editorReducer(s, { type: "appendPoint", id: "x", point: { x: 5, y: 5 } });
    s = editorReducer(s, { type: "appendPoint", id: "x", point: { x: 9, y: 9 } });
    expect((s.layers[0] as { points: unknown[] }).points).toHaveLength(3);
    s = editorReducer(s, { type: "undo" });
    expect(s.layers).toHaveLength(0);
  });
});
