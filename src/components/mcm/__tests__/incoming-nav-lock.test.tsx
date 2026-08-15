import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { setIncomingCallActive, isIncomingCallActive } from "@/lib/calls/incoming-lock";

describe("incoming call nav lock", () => {
  afterEach(() => act(() => setIncomingCallActive(false)));

  it("menandai body saat panggilan masuk aktif", () => {
    act(() => setIncomingCallActive(true));
    expect(isIncomingCallActive()).toBe(true);
    expect(document.body.hasAttribute("data-incoming-call")).toBe(true);
    act(() => setIncomingCallActive(false));
    expect(document.body.hasAttribute("data-incoming-call")).toBe(false);
  });
});
