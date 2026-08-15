import { describe, expect, it } from "vitest";
import { dueReminders, remindAtFrom, type CallReminder } from "@/lib/api/call-reminders";

const base = new Date("2026-08-15T10:00:00+07:00");

function row(p: Partial<CallReminder>): CallReminder {
  return {
    id: "r1",
    user_id: "u1",
    call_id: null,
    conversation_id: null,
    peer_id: null,
    peer_name: null,
    note: null,
    remind_at: base.toISOString(),
    done_at: null,
    created_at: base.toISOString(),
    ...p,
  } as CallReminder;
}

describe("pengingat tindak lanjut panggilan", () => {
  it("preset 30 menit dan 2 jam relatif terhadap sekarang", () => {
    expect(remindAtFrom("30m", base).getTime() - base.getTime()).toBe(30 * 60_000);
    expect(remindAtFrom("2h", base).getTime() - base.getTime()).toBe(2 * 60 * 60_000);
  });

  it("preset besok jatuh pada 09:00 hari berikutnya", () => {
    const d = remindAtFrom("besok", base);
    expect(d.getDate()).toBe(base.getDate() + 1);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it("hanya pengingat jatuh tempo dan belum selesai yang muncul", () => {
    const rows = [
      row({ id: "lewat", remind_at: new Date(base.getTime() - 1000).toISOString() }),
      row({ id: "nanti", remind_at: new Date(base.getTime() + 60_000).toISOString() }),
      row({
        id: "selesai",
        remind_at: new Date(base.getTime() - 1000).toISOString(),
        done_at: base.toISOString(),
      }),
    ];
    expect(dueReminders(rows, base).map((r) => r.id)).toEqual(["lewat"]);
  });
});
