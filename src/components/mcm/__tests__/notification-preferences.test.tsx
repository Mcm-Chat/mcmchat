import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  prefs: { badge: true, tasks: true, sales: true } as Record<string, boolean>,
  list: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "user-a" } }) }));
vi.mock("@/lib/settings/use-settings", () => ({
  useUserSettings: () => ({ settings: { notifications: state.prefs } }),
}));
vi.mock("@/lib/api/settings", () => ({
  notificationsOf: (row: { notifications: Record<string, boolean> }) => row.notifications,
}));
vi.mock("@/lib/api/notifications", () => ({
  listNotifications: (...args: unknown[]) => state.list(...args),
  subscribeNotifications: () => () => undefined,
  markAllRead: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("@/lib/api/queries", () => ({
  useConversations: () => ({ data: [{ me: { is_archived: false }, unread: 3 }] }),
  useCalls: () => ({ data: [] }),
  useLedgers: () => ({ data: [] }),
}));
vi.mock("@/lib/calls/incoming-lock", () => ({ useIncomingCallActive: () => false }));
vi.mock("@/lib/calls/missed-seen", () => ({
  useMissedCallsSeen: () => null,
  isMissedUnseen: () => false,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ preloadRoute: vi.fn().mockResolvedValue(undefined) }),
  useRouterState: () => "/profile",
}));

import { NotificationBell } from "../notification-parts";
import { BottomNavigation } from "../app-shell";

beforeEach(() => {
  vi.clearAllMocks();
  state.prefs = { badge: true, tasks: true, sales: true };
  state.list.mockResolvedValue([
    { id: "task", title: "Tugas baru", kind: "task_assigned", is_read: false },
    { id: "sale", title: "Penjualan baru", kind: "sale", is_read: false },
  ]);
});
afterEach(cleanup);

describe("notification preference consumers", () => {
  it("badge toggle hides and restores counts on the bell and bottom navigation", async () => {
    const view = render(
      <>
        <NotificationBell userId="user-a" />
        <BottomNavigation />
      </>,
    );
    await screen.findByRole("button", { name: "Notifikasi, 2 belum dibaca" });
    expect(screen.getByRole("link", { name: "Chat, 3 item baru" })).toBeInTheDocument();
    state.prefs = { ...state.prefs, badge: false };
    view.rerender(
      <>
        <NotificationBell userId="user-a" />
        <BottomNavigation />
      </>,
    );
    expect(screen.getByRole("button", { name: "Notifikasi" })).not.toHaveTextContent("2");
    expect(screen.getByRole("link", { name: "Chat" })).not.toHaveTextContent("3");
    state.prefs = { ...state.prefs, badge: true };
    view.rerender(
      <>
        <NotificationBell userId="user-a" />
        <BottomNavigation />
      </>,
    );
    expect(screen.getByRole("button", { name: "Notifikasi, 2 belum dibaca" })).toBeInTheDocument();
  });

  it("category updates immediately change the bell count without reloading notifications", async () => {
    const view = render(<NotificationBell userId="user-a" />);
    await screen.findByRole("button", { name: "Notifikasi, 2 belum dibaca" });
    state.prefs = { ...state.prefs, tasks: false };
    view.rerender(<NotificationBell userId="user-a" />);
    expect(screen.getByRole("button", { name: "Notifikasi, 1 belum dibaca" })).toBeInTheDocument();
    expect(state.list).toHaveBeenCalledOnce();
  });

  it("delayed notifications cannot expose the previous account's count", async () => {
    let resolveOld!: (value: unknown[]) => void;
    state.list
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce([]);
    const view = render(<NotificationBell userId="user-a" />);
    view.rerender(<NotificationBell userId="user-b" />);
    await waitFor(() => expect(state.list).toHaveBeenCalledWith("user-b"));
    await act(async () => resolveOld([{ id: "old", is_read: false, kind: "task_assigned" }]));
    expect(screen.getByRole("button", { name: "Notifikasi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /1 belum dibaca/ })).toBeNull();
  });
});
