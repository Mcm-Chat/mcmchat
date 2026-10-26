import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  history: vi.fn(),
  clear: vi.fn(),
  connect: vi.fn(),
  device: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "alice" } }) }));
vi.mock("@/lib/api/call-diagnostics", () => ({
  listDiagnosticRuns: mock.history,
  clearDiagnosticRuns: mock.clear,
  recordDiagnosticRun: vi.fn(),
}));
vi.mock("@/lib/calls/calls.functions", () => ({
  getCallConfig: vi.fn(async () => ({ configured: true })),
}));
vi.mock("@/lib/calls/diagnostics.functions", () => ({ issueDiagnosticToken: vi.fn() }));
vi.mock("@/lib/calls/diagnostics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calls/diagnostics")>()),
  readPermission: vi.fn(async () => "granted"),
  runLiveKitConnectTest: mock.connect,
  testLocalDevices: mock.device,
}));
vi.mock("@/components/mcm/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MobileHeader: () => null,
}));
import { Route } from "../settings.calls";
const CallDiagnosticsPage = Route.options.component as React.ComponentType;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.history.mockResolvedValue([]);
  mock.connect.mockRejectedValue(new Error("SDK gagal dimuat"));
  mock.device.mockResolvedValue({
    id: "device",
    label: "Mikrofon",
    status: "pass",
    detail: "Terbuka",
  });
});
it("renders history failures and supports retry", async () => {
  mock.history.mockRejectedValueOnce(new Error("Riwayat offline"));
  render(<CallDiagnosticsPage />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Riwayat offline"));
  fireEvent.click(screen.getByRole("button", { name: "Coba muat riwayat" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(mock.history).toHaveBeenCalledTimes(2);
});
it("handles a rejected LiveKit import/test and never claims Android calls are verified", async () => {
  render(<CallDiagnosticsPage />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Tes koneksi LiveKit" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Tes koneksi LiveKit" }));
  await waitFor(() => expect(screen.getByText(/Gagal: SDK gagal dimuat/)).toBeInTheDocument());
  expect(screen.getByText(/Hasil ini belum membuktikan audio\/video dua arah/)).toBeInTheDocument();
  expect(screen.queryByText("Panggilan siap digunakan.")).toBeNull();
});

it("ignores an older focus refresh after history deletion and suppresses refresh while clearing", async () => {
  const oldRun = {
    id: "run-old",
    status: "pass",
    latency_ms: 20,
    code: "ok",
    detail: "Hasil lama yang dihapus",
    created_at: "2026-10-27T09:00:00Z",
  };
  let finishRefresh!: (rows: (typeof oldRun)[]) => void;
  let finishClear!: () => void;
  mock.history.mockResolvedValueOnce([oldRun]).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRefresh = resolve;
      }),
  );
  mock.clear.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishClear = resolve;
      }),
  );
  render(<CallDiagnosticsPage />);
  await waitFor(() => expect(screen.getByText(oldRun.detail)).toBeInTheDocument());
  fireEvent.focus(window);
  await waitFor(() => expect(mock.history).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
  fireEvent.focus(window);
  expect(mock.history).toHaveBeenCalledTimes(2);
  await act(async () => finishClear());
  await waitFor(() => expect(screen.queryByText(oldRun.detail)).toBeNull());
  await act(async () => finishRefresh([oldRun]));
  await waitFor(() => expect(screen.queryByText("Memuat riwayat…")).toBeNull());
  expect(screen.queryByText(oldRun.detail)).toBeNull();
});
