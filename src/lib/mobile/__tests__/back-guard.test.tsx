import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useState } from "react";
import {
  useBackDismiss,
  backGuardDepth,
  backGuardMarkerActive,
  __resetBackGuard,
} from "@/lib/mobile/back-guard";

function Overlay({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  useBackDismiss(open, onDismiss);
  return null;
}

function pressBack() {
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
}

function Stacked() {
  const [bottom, setBottom] = useState(true);
  const [top, setTop] = useState(true);
  return (
    <>
      <Overlay open={bottom} onDismiss={() => setBottom(false)} />
      <Overlay open={top} onDismiss={() => setTop(false)} />
      <span data-testid="state">{`${bottom ? "b" : "-"}${top ? "t" : "-"}`}</span>
    </>
  );
}

describe("back-guard LIFO", () => {
  beforeEach(() => {
    __resetBackGuard();
    window.history.replaceState(null, "", "/chat/1");
  });
  afterEach(() => {
    cleanup();
    __resetBackGuard();
  });

  it("menutup hanya overlay teratas per Back", () => {
    const { getByTestId } = render(<Stacked />);
    expect(getByTestId("state").textContent).toBe("bt");
    expect(backGuardDepth()).toBe(2);
    // Satu penanda saja untuk seluruh stack.
    expect(backGuardMarkerActive()).toBe(true);

    pressBack();
    expect(getByTestId("state").textContent).toBe("b-");
    expect(backGuardDepth()).toBe(1);
    expect(backGuardMarkerActive()).toBe(true);

    pressBack();
    expect(getByTestId("state").textContent).toBe("--");
    expect(backGuardDepth()).toBe(0);
    expect(backGuardMarkerActive()).toBe(false);
  });

  it("penutupan lewat UI tidak mengubah route dan tidak menyisakan penanda", () => {
    const before = window.location.pathname;
    function UiClose() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Overlay open={open} onDismiss={() => setOpen(false)} />
          <button onClick={() => setOpen(false)}>tutup</button>
        </>
      );
    }
    const { getByText } = render(<UiClose />);
    expect(backGuardDepth()).toBe(1);
    act(() => getByText("tutup").click());
    expect(backGuardDepth()).toBe(0);
    expect(backGuardMarkerActive()).toBe(false);
    expect(window.location.pathname).toBe(before);
  });

  it("unmount tidak menyisakan listener atau penanda", () => {
    const { unmount } = render(<Stacked />);
    expect(backGuardDepth()).toBe(2);
    unmount();
    expect(backGuardDepth()).toBe(0);
    expect(backGuardMarkerActive()).toBe(false);
    // Back setelah unmount tidak boleh melempar / memanggil dismiss apa pun.
    expect(() => pressBack()).not.toThrow();
  });
});

/** Meniru chat.$id.tsx: selection + confirmAll di-set pada render yang sama. */
function ChatSelectionConfirm() {
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  useBackDismiss(confirmAll, () => setConfirmAll(false));
  useBackDismiss(selection.length > 0 && !confirmAll, () => setSelection([]));
  return (
    <>
      <button
        data-testid="open"
        onClick={() => {
          setSelection(["m1"]);
          setConfirmAll(true);
        }}
      />
      <span data-testid="chat">{`${selection.length}${confirmAll ? "C" : "-"}`}</span>
    </>
  );
}

describe("chat selection + confirm back priority", () => {
  beforeEach(() => {
    __resetBackGuard();
    window.history.replaceState(null, "", "/chat/1");
  });
  afterEach(() => {
    cleanup();
    __resetBackGuard();
  });

  it("Back 1 menutup confirm, Back 2 menutup mode pilih", () => {
    const { getByTestId } = render(<ChatSelectionConfirm />);
    act(() => {
      getByTestId("open").click();
    });
    expect(getByTestId("chat").textContent).toBe("1C");
    pressBack();
    expect(getByTestId("chat").textContent).toBe("1-");
    pressBack();
    expect(getByTestId("chat").textContent).toBe("0-");
    expect(backGuardDepth()).toBe(0);
    expect(backGuardMarkerActive()).toBe(false);
  });
});

/** Overlay A ditutup dan overlay B dibuka pada tick yang sama (tile sheet). */
function SwapOverlays() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <>
      <Overlay open={a} onDismiss={() => setA(false)} />
      <Overlay open={b} onDismiss={() => setB(false)} />
      <button
        data-testid="swap"
        onClick={() => {
          setA(false);
          setB(true);
        }}
      />
      <span data-testid="swap-state">{`${a ? "a" : "-"}${b ? "b" : "-"}`}</span>
    </>
  );
}

describe("tukar overlay pada tick yang sama", () => {
  beforeEach(() => {
    __resetBackGuard();
    window.history.replaceState(null, "", "/chat/1");
  });
  afterEach(() => {
    cleanup();
    __resetBackGuard();
  });

  it("overlay baru tidak ikut tertutup oleh popstate dari pelepasan penanda", async () => {
    const { getByTestId } = render(<SwapOverlays />);
    act(() => {
      getByTestId("swap").click();
    });
    expect(getByTestId("swap-state").textContent).toBe("-b");
    // Popstate susulan akibat history.back() internal.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(getByTestId("swap-state").textContent).toBe("-b");
    expect(backGuardDepth()).toBe(1);
    expect(backGuardMarkerActive()).toBe(true);
  });
});
