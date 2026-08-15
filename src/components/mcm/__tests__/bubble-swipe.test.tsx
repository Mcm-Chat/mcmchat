/**
 * Gestur swipe pada bubble chat:
 *   geser kanan  -> aksi "reply" (balas)
 *   geser kiri   -> aksi "forward" (teruskan)
 * Termasuk guard: gerakan vertikal (scroll) tidak boleh memicu aksi apa pun,
 * dan gerakan horizontal di bawah ambang batas juga tidak memicu aksi.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MessageRow } from "@/lib/api/chat";
import { MessageBubble } from "../chat-parts";

const render = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const message = {
  id: "m1",
  conversation_id: "c1",
  sender_id: "u1",
  kind: "text",
  body: "Halo dunia",
  created_at: new Date("2026-01-01T00:00:00Z").toISOString(),
  edited_at: null,
  reply_to: null,
  attachment_url: null,
  metadata: null,
} as unknown as MessageRow;

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] };
}

function setup() {
  const onAction = vi.fn();
  render(
    <MessageBubble
      message={message}
      senderName="Ace"
      mine={false}
      showSender={false}
      reactions={[]}
      status="read"
      onAction={onAction}
    />,
  );
  const bubble = screen.getByText("Halo dunia").closest("div.group") as HTMLElement;
  expect(bubble).toBeTruthy();
  return { onAction, bubble };
}

function drag(bubble: HTMLElement, dx: number, dy = 0, steps = 4) {
  fireEvent.touchStart(bubble, touch(120, 300));
  for (let i = 1; i <= steps; i += 1) {
    fireEvent.touchMove(bubble, touch(120 + (dx * i) / steps, 300 + (dy * i) / steps));
  }
  fireEvent.touchEnd(bubble, { touches: [] });
}

describe("swipe bubble chat", () => {
  it("geser kanan memicu balas", () => {
    const { onAction, bubble } = setup();
    drag(bubble, 140);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toBe("reply");
    expect(onAction.mock.calls[0]?.[1]).toMatchObject({ id: "m1" });
  });

  it("geser kiri memicu teruskan", () => {
    const { onAction, bubble } = setup();
    drag(bubble, -140);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toBe("forward");
  });

  it("geser vertikal (scroll) tidak memicu aksi dan tidak menggeser bubble", () => {
    const { onAction, bubble } = setup();
    drag(bubble, 10, 200);
    expect(onAction).not.toHaveBeenCalled();
    expect(bubble.style.transform === "" || bubble.style.transform === "none").toBe(true);
  });

  it("geser horizontal pendek di bawah ambang tidak memicu aksi", () => {
    const { onAction, bubble } = setup();
    drag(bubble, 30);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("touchcancel mengembalikan posisi tanpa aksi", () => {
    const { onAction, bubble } = setup();
    fireEvent.touchStart(bubble, touch(120, 300));
    fireEvent.touchMove(bubble, touch(240, 300));
    fireEvent.touchCancel(bubble, { touches: [] });
    expect(onAction).not.toHaveBeenCalled();
    expect(bubble.style.transform === "" || bubble.style.transform === "none").toBe(true);
  });

  it("mode seleksi menonaktifkan swipe", () => {
    const onAction = vi.fn();
    render(
      <MessageBubble
        message={message}
        senderName="Ace"
        mine={false}
        showSender={false}
        reactions={[]}
        status="read"
        onAction={onAction}
        selectable
      />,
    );
    const bubble = screen.getByText("Halo dunia").closest("div.group") as HTMLElement;
    drag(bubble, 140);
    expect(onAction.mock.calls.every((c) => c[0] !== "reply")).toBe(true);
  });
});
