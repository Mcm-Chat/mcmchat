import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_VOICE_PREFS } from "@/lib/voice/presets";

const state = vi.hoisted(() => ({
  user: { id: "alice" },
  settings: null as unknown,
  error: null as string | null,
  loading: false,
  patch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/settings/use-settings", () => ({
  useUserSettings: () => ({ ...state, saving: false }),
}));
vi.mock("@/lib/api/settings", () => ({
  voiceOf: (row: { voice?: unknown } | null) => row?.voice ?? DEFAULT_VOICE_PREFS,
}));
vi.mock("@/lib/api/entitlements", () => ({
  FEATURE_VOICE_EFFECTS: "voice",
  useEntitlement: () => ({ active: false }),
}));
vi.mock("@/components/mcm/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MobileHeader: () => null,
}));
vi.mock("@/components/mcm/voice-effects", () => ({
  VoiceEffectsPanel: ({
    prefs,
    onChange,
  }: {
    prefs: typeof DEFAULT_VOICE_PREFS;
    onChange: (p: typeof DEFAULT_VOICE_PREFS) => void;
  }) => (
    <button onClick={() => onChange({ ...prefs, intensity: 0.9 })}>
      Intensity {prefs.intensity}
    </button>
  ),
}));
import { Route } from "../settings.voice";
const VoiceSettingsPage = Route.options.component as React.ComponentType;

afterEach(cleanup);
beforeEach(() => {
  state.user = { id: "alice" };
  state.settings = { user_id: "alice", voice: DEFAULT_VOICE_PREFS };
  state.error = null;
  state.loading = false;
  state.patch.mockReset().mockResolvedValue({});
});

it("shows a loading failure and retry without presenting defaults as saved", () => {
  state.settings = null;
  state.error = "Tidak tersambung";
  render(<VoiceSettingsPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("Tidak tersambung");
  expect(screen.queryByRole("button", { name: /Intensity/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
  expect(state.refresh).toHaveBeenCalled();
});

it("saves only explicit edits; a failed write preserves the draft for retry", async () => {
  state.patch.mockRejectedValueOnce(new Error("Koneksi terputus"));
  render(<VoiceSettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Intensity 0.7" }));
  expect(state.patch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Simpan preferensi" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Koneksi terputus"));
  expect(screen.getByRole("button", { name: "Intensity 0.9" })).toBeInTheDocument();
  expect(state.patch).toHaveBeenCalledWith({ voice: { intensity: 0.9 } });
  fireEvent.click(screen.getByRole("button", { name: "Simpan preferensi" }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
});

it("clears unsaved drafts when the authenticated account changes", () => {
  const view = render(<VoiceSettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Intensity 0.7" }));
  state.user = { id: "bob" };
  state.settings = { user_id: "bob", voice: DEFAULT_VOICE_PREFS };
  view.rerender(<VoiceSettingsPage />);
  expect(screen.getByRole("button", { name: "Intensity 0.7" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Simpan preferensi" })).toBeDisabled();
});
