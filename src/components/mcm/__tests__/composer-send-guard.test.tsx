import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup, screen } from "@testing-library/react";
import { ChatComposer } from "@/components/mcm/chat-parts";

afterEach(cleanup);

function renderComposer(onSend: () => void | Promise<void>) {
  return render(
    <ChatComposer
      value="halo"
      onChange={() => {}}
      onSend={onSend}
      onAttach={() => {}}
      onVoice={() => {}}
      onNewLedger={() => {}}
    />,
  );
}

describe("ChatComposer double-send guard", () => {
  it("dua klik kirim beruntun hanya memanggil onSend sekali", () => {
    const onSend = vi.fn(async () => {});
    renderComposer(onSend);
    const btn = screen.getByRole("button", { name: /kirim/i });
    act(() => {
      btn.click();
      btn.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("lock tidak dilepas pada microtask yang sama", async () => {
    const onSend = vi.fn(async () => {});
    renderComposer(onSend);
    const btn = screen.getByRole("button", { name: /kirim/i });
    act(() => {
      btn.click();
    });
    await Promise.resolve();
    await Promise.resolve();
    act(() => {
      btn.click();
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
