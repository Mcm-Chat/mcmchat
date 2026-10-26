import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPreferenceControls } from "../account-preference-controls";

const mock = vi.hoisted(() => ({
  state: { settings: null as unknown, loading: false, error: null as string | null, saving: false },
  patch: vi.fn(),
  refresh: vi.fn(),
  setTheme: vi.fn(),
  setMotion: vi.fn(),
  theme: "dark",
  motion: "auto",
  reduced: false,
  active: "account-a",
  error: vi.fn(),
}));
vi.mock("@/lib/settings/use-settings", () => ({
  useUserSettings: () => ({ ...mock.state, patch: mock.patch, refresh: mock.refresh }),
}));
vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: mock.theme, setTheme: mock.setTheme }),
}));
vi.mock("@/lib/session-scope", () => ({ getActiveUserId: () => mock.active }));
vi.mock("@/lib/a11y/reduce-motion", () => ({
  useReduceMotion: () => ({
    preference: mock.motion,
    reduced: mock.reduced,
    setPreference: mock.setMotion,
  }),
}));
vi.mock("@/lib/api/settings", () => ({
  privacyOf: (row: { privacy: unknown } | null) =>
    row?.privacy ?? { online: true, readReceipts: true },
}));
vi.mock("sonner", () => ({ toast: { error: mock.error } }));

const row = {
  user_id: "account-a",
  theme: "dark",
  privacy: { online: false, readReceipts: true },
  security: { appLock: true, twoFactor: true },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.state = { settings: row, loading: false, error: null, saving: false };
  mock.theme = "dark";
  mock.motion = "auto";
  mock.reduced = false;
  mock.active = "account-a";
  mock.patch.mockResolvedValue({ ...row, theme: "light" });
});
afterEach(cleanup);

describe("account settings controls", () => {
  it("does not expose defaults as loaded account choices or allow a write during loading", () => {
    mock.state = { settings: null, loading: true, error: null, saving: false };
    render(<AccountPreferenceControls userId="account-a" />);
    expect(screen.getByRole("switch", { name: "Mode gelap" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Centang dibaca" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Centang dibaca" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Memuat pengaturan");
  });

  it("shows load failure and a working retry while local animation remains available", () => {
    mock.state.error = "Koneksi terputus";
    render(<AccountPreferenceControls userId="account-a" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Koneksi terputus");
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang pengaturan" }));
    expect(mock.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("switch", { name: "Mode gelap" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Kurangi animasi" })).not.toBeDisabled();
  });

  it("waits for persistence before applying theme and leaves it unchanged on failure", async () => {
    mock.patch.mockRejectedValueOnce(new Error("Gagal menyimpan tema"));
    render(<AccountPreferenceControls userId="account-a" />);
    fireEvent.click(screen.getByRole("switch", { name: "Mode gelap" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith("Gagal menyimpan tema"));
    expect(mock.setTheme).not.toHaveBeenCalled();
    const save = deferred<typeof row>();
    mock.patch.mockReturnValueOnce(save.promise);
    fireEvent.click(screen.getByRole("switch", { name: "Mode gelap" }));
    expect(mock.setTheme).not.toHaveBeenCalled();
    await act(async () => save.resolve({ ...row, theme: "light" }));
    expect(mock.patch).toHaveBeenLastCalledWith({ theme: "light" });
    expect(mock.setTheme).toHaveBeenCalledWith("light");
  });

  it("does not apply a finished theme save to a different account", async () => {
    const save = deferred<typeof row>();
    mock.patch.mockReturnValueOnce(save.promise);
    render(<AccountPreferenceControls userId="account-a" />);
    fireEvent.click(screen.getByRole("switch", { name: "Mode gelap" }));
    mock.active = "account-b";
    await act(async () => save.resolve({ ...row, theme: "light" }));
    expect(mock.setTheme).not.toHaveBeenCalled();
  });

  it("saves read receipts only and does not provide fake security or online switches", async () => {
    render(<AccountPreferenceControls userId="account-a" />);
    fireEvent.click(screen.getByRole("switch", { name: "Centang dibaca" }));
    expect(mock.patch).toHaveBeenCalledWith({ privacy: { readReceipts: false } });
    for (const name of ["Status online", "Kunci aplikasi", "Verifikasi dua langkah"]) {
      expect(screen.queryByRole("switch", { name })).not.toBeInTheDocument();
    }
    expect(screen.getAllByText("Belum tersedia")).toHaveLength(3);
    await act(async () => {});
  });

  it("keeps animation local and supports returning to system settings", () => {
    mock.motion = "on";
    mock.reduced = true;
    render(<AccountPreferenceControls userId="account-a" />);
    fireEvent.click(screen.getByRole("switch", { name: "Kurangi animasi" }));
    expect(mock.setMotion).toHaveBeenCalledWith("off");
    fireEvent.click(screen.getByRole("button", { name: "Ikuti animasi perangkat" }));
    expect(mock.setMotion).toHaveBeenLastCalledWith("auto");
    expect(mock.patch).not.toHaveBeenCalled();
  });
});
