import { describe, expect, it } from "vitest";
import { deriveStatus, indexReceipts, type ReceiptRow } from "../receipts";

const r = (user: string, delivered: string | null, read: string | null): ReceiptRow => ({
  message_id: "m1",
  user_id: user,
  delivered_at: delivered,
  read_at: read,
});

const T = "2026-08-12T10:00:00Z";

describe("deriveStatus", () => {
  it("tanpa receipt sama sekali => sent (satu centang)", () => {
    expect(deriveStatus([], 1)).toBe("sent");
  });

  it("baris receipt ada tapi delivered_at kosong => tetap sent", () => {
    expect(deriveStatus([r("b", null, null)], 1)).toBe("sent");
  });

  it("delivered tanpa read => delivered (dua centang netral)", () => {
    expect(deriveStatus([r("b", T, null)], 1)).toBe("delivered");
  });

  it("delivered + read => read (dua centang beraksen)", () => {
    expect(deriveStatus([r("b", T, T)], 1)).toBe("read");
  });

  it("penerima mematikan laporan dibaca: read_at tidak pernah tercatat => berhenti di delivered", () => {
    expect(deriveStatus([r("b", T, null)], 1)).toBe("delivered");
  });

  it("grup: satu dari dua sudah menerima => delivered", () => {
    expect(deriveStatus([r("b", T, T)], 2)).toBe("delivered");
  });

  it("grup: semua anggota lain sudah membaca => read", () => {
    expect(deriveStatus([r("b", T, T), r("c", T, T)], 2)).toBe("read");
  });

  it("grup: satu anggota mematikan laporan dibaca => tidak menyesatkan, tetap delivered", () => {
    expect(deriveStatus([r("b", T, T), r("c", T, null)], 2)).toBe("delivered");
  });

  it("pembaruan realtime menaikkan status tanpa reload", () => {
    let rows: ReceiptRow[] = [];
    expect(deriveStatus(rows, 1)).toBe("sent");
    rows = [r("b", T, null)];
    expect(deriveStatus(rows, 1)).toBe("delivered");
    rows = [r("b", T, T)];
    expect(deriveStatus(rows, 1)).toBe("read");
  });
});

describe("indexReceipts", () => {
  it("mengelompokkan receipt per pesan", () => {
    const idx = indexReceipts([
      { message_id: "m1", user_id: "b", delivered_at: T, read_at: null },
      { message_id: "m1", user_id: "c", delivered_at: T, read_at: T },
      { message_id: "m2", user_id: "b", delivered_at: null, read_at: null },
    ]);
    expect(idx.get("m1")).toHaveLength(2);
    expect(deriveStatus(idx.get("m2") ?? [], 1)).toBe("sent");
  });
});
