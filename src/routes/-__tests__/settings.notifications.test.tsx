import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  userId: "user-a",
  settings: null as Record<string, unknown> | null,
  error: null as string | null,
  loading: false,
  saving: false,
  refresh: vi.fn(),
  patch: vi.fn(),
  listDevices: vi.fn(),
  removeDevice: vi.fn(),
  removeAllDevices: vi.fn(),
  requestPermission: vi.fn(),
  getPushStatus: vi.fn(),
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/components/mcm/app-shell", () => ({
  AppShell: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <main>
      {header}
      {children}
    </main>
  ),
  MobileHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock("@/lib/settings/use-settings", () => ({
  useUserSettings: () => ({
    settings: state.settings,
    error: state.error,
    loading: state.loading,
    saving: state.saving,
    refresh: state.refresh,
    patch: state.patch,
  }),
}));
vi.mock("@/lib/api/settings", () => ({
  listDevices: (...args: unknown[]) => state.listDevices(...args),
  removeDevice: (...args: unknown[]) => state.removeDevice(...args),
  removeAllDevices: (...args: unknown[]) => state.removeAllDevices(...args),
  notificationsOf: (row: { notifications?: Record<string, boolean> } | null) => ({
    push: true,
    preview: true,
    sound: true,
    vibrate: true,
    chat: true,
    group: true,
    calls: true,
    tasks: true,
    sales: true,
    ledger: true,
    badge: true,
    ...row?.notifications,
  }),
}));
vi.mock("@/lib/push/push.functions", () => ({ getPushStatus: () => state.getPushStatus() }));
vi.mock("@/lib/push/native", () => ({
  openFullScreenIntentSettings: vi.fn().mockResolvedValue({ opened: false }),
  openNotificationSettings: vi.fn().mockResolvedValue({ opened: false }),
  pushCapabilities: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/push/use-push", () => ({
  enablePush: vi.fn(),
  refreshPushSession: vi.fn().mockResolvedValue(undefined),
  usePushState: () => ({
    native: false,
    receiverInstalled: false,
    webPush: false,
    permission: "prompt",
    registered: false,
  }),
}));
vi.mock("@/lib/push/permissions", () => ({
  PERM_LABEL: Object.fromEntries(
    ["notifications", "camera", "microphone", "location", "photos"].map((key) => [
      key,
      { title: key, desc: key },
    ]),
  ),
  STATE_LABEL: {
    granted: "Diizinkan",
    prompt: "Belum diminta",
    denied: "Ditolak",
    restricted: "Dibatasi",
    unsupported: "Tidak tersedia",
  },
  checkPermission: vi.fn().mockResolvedValue("prompt"),
  openAppSettings: vi.fn().mockResolvedValue(false),
  requestPermission: (...args: unknown[]) => state.requestPermission(...args),
}));
vi.mock("sonner", () => ({
  toast: { error: state.errorToast, success: state.successToast, info: vi.fn() },
}));

import { Route } from "../settings.notifications";
const NotificationSettingsPage = Route.options.component as React.ComponentType;

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = "user-a";
  state.settings = { user_id: "user-a", notifications: {} };
  state.error = null;
  state.loading = false;
  state.saving = false;
  state.listDevices.mockResolvedValue([]);
  state.removeDevice.mockResolvedValue(undefined);
  state.removeAllDevices.mockResolvedValue(1);
  state.getPushStatus.mockResolvedValue({ configured: true });
  state.patch.mockResolvedValue(state.settings);
});
afterEach(cleanup);

describe("notification settings controls and failures", () => {
  it("does not present default switches as loaded preferences", async () => {
    state.settings = null;
    state.loading = true;
    render(<NotificationSettingsPage />);
    expect(screen.getByText("Memuat preferensi…")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    await screen.findByText("Belum ada perangkat terdaftar.");
  });

  it("shows independent settings and device load errors with retries", async () => {
    state.settings = null;
    state.error = "Preferensi sedang offline";
    state.listDevices.mockRejectedValueOnce(new Error("Perangkat sedang offline"));
    render(<NotificationSettingsPage />);
    expect(screen.getByText("Preferensi sedang offline")).toBeInTheDocument();
    expect(await screen.findByText("Perangkat sedang offline")).toBeInTheDocument();
    expect(screen.queryByText("Belum ada perangkat terdaftar.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba muat preferensi lagi" }));
    expect(state.refresh).toHaveBeenCalledOnce();
    state.listDevices.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Coba muat perangkat lagi" }));
    await screen.findByText("Belum ada perangkat terdaftar.");
  });

  it("each named switch saves exactly its preference and save failure keeps prior state", async () => {
    state.patch.mockRejectedValueOnce(new Error("Penyimpanan ditolak"));
    render(<NotificationSettingsPage />);
    const sound = screen.getByRole("switch", { name: "Suara push" });
    fireEvent.click(sound);
    expect(state.patch).toHaveBeenCalledWith({ notifications: { sound: false } });
    await waitFor(() => expect(state.errorToast).toHaveBeenCalledWith("Penyimpanan ditolak"));
    expect(sound).toBeChecked();
    expect(state.successToast).not.toHaveBeenCalled();
    expect(screen.getAllByRole("switch")).toHaveLength(11);
    screen.getAllByRole("switch").forEach((control) => expect(control).toHaveAccessibleName());
  });

  it("category preferences remain usable when account push is disabled", async () => {
    state.settings = { user_id: "user-a", notifications: { push: false } };
    render(<NotificationSettingsPage />);
    expect(screen.getByRole("switch", { name: "Notifikasi Pesan pribadi" })).toBeEnabled();
    fireEvent.click(screen.getByRole("switch", { name: "Notifikasi Pesan pribadi" }));
    expect(state.patch).toHaveBeenCalledWith({ notifications: { chat: false } });
    await waitFor(() => expect(state.successToast).toHaveBeenCalled());
  });

  it("unknown server status stays distinct from an unconfigured server", async () => {
    state.getPushStatus.mockRejectedValueOnce(new Error("Server tidak dapat dihubungi"));
    render(<NotificationSettingsPage />);
    expect(await screen.findByText("Belum diketahui")).toBeInTheDocument();
    expect(screen.getByText("Server tidak dapat dihubungi")).toBeInTheDocument();
    expect(screen.queryByText("Perlu konfigurasi pengirim oleh admin.")).toBeNull();
  });

  it("reports permission request exceptions without an unhandled rejection", async () => {
    state.requestPermission.mockRejectedValueOnce(new Error("Jembatan perangkat gagal"));
    render(<NotificationSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Izinkan camera" }));
    await waitFor(() => expect(state.errorToast).toHaveBeenCalledWith("Jembatan perangkat gagal"));
    expect(screen.getByRole("button", { name: "Izinkan camera" })).toBeEnabled();
  });

  it("revokes push honestly without claiming to end account sessions", async () => {
    state.listDevices.mockResolvedValueOnce([
      {
        id: "device-a",
        name: "Android A",
        platform: "android",
        push_enabled: true,
        revoked: false,
      },
    ]);
    render(<NotificationSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cabut push Android A" }));
    await waitFor(() => expect(state.removeDevice).toHaveBeenCalledWith("device-a"));
    await screen.findByText(/push dicabut/);
    expect(state.successToast).toHaveBeenCalledWith("Push perangkat dicabut");
    expect(screen.queryByText(/Keluar dari semua perangkat/)).toBeNull();
    expect(screen.getByText(/Sesi masuk akun tidak dikeluarkan/)).toBeInTheDocument();
  });

  it("ignores delayed device results from the preceding account", async () => {
    let resolveOld!: (value: unknown[]) => void;
    state.listDevices.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const view = render(<NotificationSettingsPage />);
    state.userId = "user-b";
    state.settings = { user_id: "user-b", notifications: {} };
    view.rerender(<NotificationSettingsPage />);
    await screen.findByText("Belum ada perangkat terdaftar.");
    await act(async () =>
      resolveOld([{ id: "old", name: "PERANGKAT AKUN LAMA", push_enabled: true }]),
    );
    expect(screen.queryByText("PERANGKAT AKUN LAMA")).toBeNull();
  });
});
