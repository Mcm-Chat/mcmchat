import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  push: { permission: "granted", registered: false },
  check: vi.fn(),
  open: vi.fn(),
  enable: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/push/permissions", () => ({
  checkPermission: () => mocks.check(),
  openAppSettings: () => mocks.open(),
}));
vi.mock("@/lib/push/use-push", () => ({
  enablePush: (...args: unknown[]) => mocks.enable(...args),
  usePushState: () => mocks.push,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, success: mocks.success, info: mocks.info },
}));
import { NotificationPermissionRow } from "../notification-permission-row";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.push = { permission: "granted", registered: false };
  mocks.check.mockResolvedValue("granted");
  mocks.open.mockResolvedValue(true);
  mocks.enable.mockResolvedValue({ permission: "granted", registered: true });
});
afterEach(cleanup);

describe("notification permission row", () => {
  it("offers explicit registration when permission is already granted", async () => {
    render(<NotificationPermissionRow userId="user-a" />);
    const register = await screen.findByRole("button", { name: "Daftarkan perangkat" });
    expect(screen.getByText("Diizinkan")).toBeInTheDocument();
    expect(screen.queryByText(/sedang didaftarkan/)).toBeNull();
    expect(mocks.enable).not.toHaveBeenCalled();
    fireEvent.click(register);
    await waitFor(() => expect(mocks.enable).toHaveBeenCalledWith("user-a"));
    expect(mocks.success).toHaveBeenCalledWith(
      "Token push perangkat terdaftar. Uji pengiriman untuk memeriksa penerimaan.",
    );
    expect(mocks.success).not.toHaveBeenCalledWith("Notifikasi aktif di perangkat ini");
  });
  it("distinguishes registered tokens from proven notification delivery", async () => {
    mocks.push.registered = true;
    render(<NotificationPermissionRow userId="user-a" />);
    await screen.findByText(/Token perangkat terdaftar/);
    expect(screen.queryByRole("button", { name: "Daftarkan perangkat" })).toBeNull();
    expect(screen.getByText("Diizinkan")).toBeInTheDocument();
    expect(screen.queryByText("Aktif")).toBeNull();
  });
  it("catches registration failures and restores the action", async () => {
    mocks.enable.mockRejectedValueOnce(new Error("Pendaftaran sedang offline"));
    render(<NotificationPermissionRow userId="user-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Daftarkan perangkat" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Pendaftaran sedang offline"));
    expect(screen.getByRole("button", { name: "Daftarkan perangkat" })).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("uses a fresh permission check on focus and visibility even when push state is stale", async () => {
    render(<NotificationPermissionRow userId="user-a" />);
    await screen.findByRole("button", { name: "Daftarkan perangkat" });
    mocks.check.mockResolvedValue("denied");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("Diblokir")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buka setelan" })).toBeInTheDocument();
    mocks.check.mockResolvedValue("granted");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByRole("button", { name: "Daftarkan perangkat" })).toBeInTheDocument();
    expect(mocks.enable).not.toHaveBeenCalled();
  });
  it("reports permission check failures and supports retry", async () => {
    mocks.check.mockRejectedValueOnce(new Error("Izin belum dapat diperiksa"));
    render(<NotificationPermissionRow userId="user-a" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Izin belum dapat diperiksa");
    expect(screen.getByText("Belum diketahui")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Periksa izin lagi" }));
    await screen.findByRole("button", { name: "Daftarkan perangkat" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("catches errors when opening device settings", async () => {
    mocks.check.mockResolvedValue("denied");
    mocks.open.mockRejectedValueOnce(new Error("Pengaturan gagal dibuka"));
    render(<NotificationPermissionRow userId="user-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Buka setelan" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Pengaturan gagal dibuka"));
    expect(screen.getByRole("button", { name: "Buka setelan" })).toBeEnabled();
  });
  it("ignores an old opt-in response after account switch and removes resume listeners on unmount", async () => {
    let resolve!: (value: unknown) => void;
    mocks.enable.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<NotificationPermissionRow userId="user-a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Daftarkan perangkat" }));
    view.rerender(<NotificationPermissionRow userId="user-b" />);
    await act(async () => {
      resolve({ permission: "granted", registered: true });
    });
    expect(mocks.success).not.toHaveBeenCalled();
    view.unmount();
    const checks = mocks.check.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.check).toHaveBeenCalledTimes(checks);
  });
});
