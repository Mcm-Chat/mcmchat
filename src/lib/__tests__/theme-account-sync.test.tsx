import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "../theme";
import { __resetSessionScope, setActiveUser } from "../session-scope";

const mock = vi.hoisted(() => ({ rows: new Map<string, { user_id: string; theme: string }>() }));
vi.mock("@/lib/settings/use-settings", () => ({
  useUserSettings: (userId: string | null) => ({
    settings: userId ? (mock.rows.get(userId) ?? null) : null,
  }),
}));
function Probe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}
const app = () => (
  <ThemeProvider>
    <Probe />
  </ThemeProvider>
);

beforeEach(() => {
  __resetSessionScope();
  localStorage.clear();
  mock.rows.clear();
  document.documentElement.className = "";
});
afterEach(() => {
  cleanup();
  __resetSessionScope();
});

describe("global account theme synchronization", () => {
  it("uses the authenticated account's remote preference over cached local theme", async () => {
    setActiveUser("a");
    localStorage.setItem("mcm:a:theme", "dark");
    mock.rows.set("a", { user_id: "a", theme: "light" });
    render(app());
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("mcm:a:theme")).toBe("light");
  });

  it("applies a newly refreshed preference on any route", async () => {
    setActiveUser("a");
    mock.rows.set("a", { user_id: "a", theme: "dark" });
    const view = render(app());
    mock.rows.set("a", { user_id: "a", theme: "light" });
    view.rerender(app());
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("resets to the next account's preference and does not adopt the global startup cache", async () => {
    setActiveUser("a");
    mock.rows.set("a", { user_id: "a", theme: "light" });
    render(app());
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));
    act(() => setActiveUser("b"));
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("dark"));
    expect(localStorage.getItem("mcm:a:theme")).toBeNull();
    expect(localStorage.getItem("mcm:b:theme")).toBeNull();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("ignores another account's returned row and malformed remote themes", async () => {
    setActiveUser("a");
    localStorage.setItem("mcm:a:theme", "light");
    mock.rows.set("a", { user_id: "b", theme: "dark" });
    const view = render(app());
    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("light"));
    mock.rows.set("a", { user_id: "a", theme: "bogus" });
    view.rerender(app());
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });
});
