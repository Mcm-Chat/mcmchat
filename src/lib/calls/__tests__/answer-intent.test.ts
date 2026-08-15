import { describe, expect, it, vi } from "vitest";
import { clearAnswerIntent, consumeAnswerIntent, markAnswerIntent } from "../answer-intent";

describe("answer intent", () => {
  it("sekali pakai untuk panggilan yang sama", () => {
    markAnswerIntent("call-1");
    expect(consumeAnswerIntent("call-1")).toBe(true);
    expect(consumeAnswerIntent("call-1")).toBe(false);
  });

  it("tidak menjawab panggilan lain", () => {
    markAnswerIntent("call-1");
    expect(consumeAnswerIntent("call-2")).toBe(false);
  });

  it("kedaluwarsa setelah 60 detik", () => {
    vi.useFakeTimers();
    markAnswerIntent("call-3");
    vi.advanceTimersByTime(61_000);
    expect(consumeAnswerIntent("call-3")).toBe(false);
    vi.useRealTimers();
  });

  it("bisa dibatalkan", () => {
    markAnswerIntent("call-4");
    clearAnswerIntent();
    expect(consumeAnswerIntent("call-4")).toBe(false);
  });
});
