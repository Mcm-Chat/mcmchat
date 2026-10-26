import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  user: { id: "alice" },
  list: vi.fn(),
  status: vi.fn(),
  send: vi.fn(),
  permission: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock("@/lib/api/settings", () => ({ listDevices: mock.list }));
vi.mock("@/lib/push/push.functions", () => ({
  getPushStatus: mock.status,
  sendPushSelfTest: mock.send,
}));
vi.mock("@/lib/push/permissions", () => ({ checkPermission: mock.permission }));
vi.mock("@/lib/push/native", () => ({ isNative: () => true }));
vi.mock("@/lib/push/web-config", () => ({ missingWebPushKeys: () => ["WEB_KEY"] }));
vi.mock("@/components/mcm/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MobileHeader: () => null,
}));
import { Route } from "../settings.push-test";
const PushTestPage = Route.options.component as React.ComponentType;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.user = { id: "alice" };
  mock.list.mockResolvedValue([
    { id: "phone", name: "Android", platform: "android", push_enabled: true, revoked: false },
  ]);
  mock.status.mockResolvedValue({ configured: true });
  mock.permission.mockResolvedValue("granted");
  mock.send.mockResolvedValue({ configured: true, sent: 1, failed: 0, devices: 1 });
});
it("reports a device load error rather than an empty device list; retry restores testing", async () => {
  mock.list.mockRejectedValueOnce(new Error("offline"));
  render(<PushTestPage />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Daftar perangkat gagal dimuat"),
  );
  expect(screen.getByRole("button", { name: "Uji pesan" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Periksa ulang" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Uji pesan" })).toBeEnabled());
  expect(screen.queryByText(/Belum lengkap: WEB_KEY/)).toBeNull();
});
it("distinguishes server submission from device delivery and clears account history", async () => {
  const view = render(<PushTestPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Uji pesan" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Uji pesan" }));
  await waitFor(() =>
    expect(screen.getByText(/1 diterima FCM.*penerimaan belum dikonfirmasi/)).toBeInTheDocument(),
  );
  mock.user = { id: "bob" };
  view.rerender(<PushTestPage />);
  expect(screen.queryByText(/1 diterima FCM/)).toBeNull();
});
