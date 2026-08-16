import { beforeEach, describe, expect, it } from "vitest";
import {
  RESTORE_TTL_MS,
  clearChatView,
  loadChatView,
  saveChatView,
  shouldRestoreScroll,
} from "@/lib/chat/scroll-restore";

describe("pemulihan posisi baca chat", () => {
  beforeEach(() => sessionStorage.clear());

  it("menyimpan dan memuat posisi", () => {
    saveChatView("c1", { top: 420, atBottom: false, composerFocused: true });
    const s = loadChatView("c1");
    expect(s?.top).toBe(420);
    expect(s?.atBottom).toBe(false);
    expect(s?.composerFocused).toBe(true);
  });

  it("mengabaikan data kedaluwarsa", () => {
    saveChatView("c2", { top: 100, atBottom: false, composerFocused: false });
    expect(loadChatView("c2", Date.now() + RESTORE_TTL_MS + 1000)).toBeNull();
  });

  it("clear menghapus entri", () => {
    saveChatView("c3", { top: 50, atBottom: false, composerFocused: false });
    clearChatView("c3");
    expect(loadChatView("c3")).toBeNull();
  });

  it("tidak memulihkan bila terakhir berada di dasar", () => {
    expect(shouldRestoreScroll(null)).toBe(false);
    expect(
      shouldRestoreScroll({ top: 300, atBottom: true, composerFocused: false, savedAt: Date.now() }),
    ).toBe(false);
    expect(
      shouldRestoreScroll({ top: 300, atBottom: false, composerFocused: false, savedAt: Date.now() }),
    ).toBe(true);
  });
});
