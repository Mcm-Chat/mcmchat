import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageTicks } from "../chat-parts";

describe("MessageTicks", () => {
  it("sent = satu centang tanpa warna aksen", () => {
    render(<MessageTicks status="sent" />);
    const el = screen.getByRole("img", { name: "Terkirim ke server" });
    expect(el.dataset['status']).toBe("sent");
    expect(el.querySelector("svg")?.classList.contains("text-tick-read")).toBe(false);
  });

  it("delivered = dua centang netral", () => {
    render(<MessageTicks status="delivered" />);
    const el = screen.getByRole("img", { name: "Sampai di perangkat penerima" });
    expect(el.dataset['status']).toBe("delivered");
    expect(el.querySelector("svg")?.classList.contains("text-tick-read")).toBe(false);
  });

  it("read = dua centang warna aksen", () => {
    render(<MessageTicks status="read" />);
    const el = screen.getByRole("img", { name: "Sudah dibaca" });
    expect(el.dataset['status']).toBe("read");
    expect(el.querySelector("svg")?.classList.contains("text-tick-read")).toBe(true);
  });
});
