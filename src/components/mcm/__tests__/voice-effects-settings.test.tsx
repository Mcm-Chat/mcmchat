import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_VOICE_PREFS } from "@/lib/voice/presets";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/voice/use-voice-preview", () => ({
  useVoicePreview: () => ({
    running: false,
    level: 0,
    pipeline: { status: "idle" },
    error: null,
    stop: vi.fn(),
    start: vi.fn(),
  }),
}));
import { VoiceEffectsPanel } from "../voice-effects";
const entitlement = {
  loading: false,
  active: false,
  billingLinked: false,
  expiresAt: null,
  source: null,
};
afterEach(cleanup);
it("does not promise an effect during calls without an active entitlement", () => {
  render(
    <VoiceEffectsPanel
      prefs={{ ...DEFAULT_VOICE_PREFS, enabled: true }}
      onChange={vi.fn()}
      entitlement={entitlement}
    />,
  );
  expect(
    screen.getByText("Efek hanya tersedia dalam pratinjau sampai langganan Premium aktif."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Efek akan aktif pada panggilan berikutnya.")).toBeNull();
});
it("exposes every custom parameter and resets the complete preference draft", () => {
  const onChange = vi.fn();
  const prefs = {
    ...DEFAULT_VOICE_PREFS,
    enabled: true,
    preset: "custom" as const,
    intensity: 1,
    custom: { ...DEFAULT_VOICE_PREFS.custom, gain: 9, character: 1 },
  };
  render(<VoiceEffectsPanel prefs={prefs} onChange={onChange} entitlement={entitlement} />);
  expect(screen.getByRole("slider", { name: "Karakter" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(onChange).toHaveBeenCalledWith(DEFAULT_VOICE_PREFS);
});
