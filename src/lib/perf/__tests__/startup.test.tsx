import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loading: true,
  session: null as null | { user: { id: string } },
  navigate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => state }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => state.navigate,
}));
import { Splash } from "@/routes/index";

describe("startup routes without a decorative delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.loading = true;
    state.session = null;
    state.navigate.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("waits for auth, then navigates immediately instead of waiting 700ms", () => {
    const view = render(<Splash />);
    act(() => vi.advanceTimersByTime(1000));
    expect(state.navigate).not.toHaveBeenCalled();
    state.loading = false;
    state.session = { user: { id: "signed-in" } };
    view.rerender(<Splash />);
    // No timer advancement after auth resolution.
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/chat", replace: true });
  });

  it("routes returning signed-out users directly to login", () => {
    state.loading = false;
    localStorage.setItem("mcm-onboarded", "1");
    render(<Splash />);
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/login", replace: true });
  });

  it("preserves onboarding for new users", () => {
    state.loading = false;
    render(<Splash />);
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/onboarding", replace: true });
  });

  it("does not leave a delayed navigation after the splash is unmounted", () => {
    const view = render(<Splash />);
    view.unmount();
    state.loading = false;
    act(() => vi.advanceTimersByTime(1000));
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
