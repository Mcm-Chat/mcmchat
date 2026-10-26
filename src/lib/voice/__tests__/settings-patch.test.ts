import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_PREFS } from "../presets";
import { changedVoicePrefs } from "../settings-patch";

describe("voice settings edit patch", () => {
  it("sends no write for unchanged preferences", () => {
    expect(changedVoicePrefs(DEFAULT_VOICE_PREFS, structuredClone(DEFAULT_VOICE_PREFS))).toEqual(
      {},
    );
  });
  it("sends only edited fields and custom parameters, preserving other-device changes", () => {
    const next = {
      ...DEFAULT_VOICE_PREFS,
      intensity: 0.8,
      custom: { ...DEFAULT_VOICE_PREFS.custom, pitch: -2 },
    };
    expect(changedVoicePrefs(DEFAULT_VOICE_PREFS, next)).toEqual({
      intensity: 0.8,
      custom: { pitch: -2 },
    });
    const currentOtherDevice = {
      ...DEFAULT_VOICE_PREFS,
      enabled: true,
      custom: { ...DEFAULT_VOICE_PREFS.custom, gain: 3 },
    };
    const patch = changedVoicePrefs(DEFAULT_VOICE_PREFS, next);
    const merged = {
      ...currentOtherDevice,
      ...patch,
      custom: { ...currentOtherDevice.custom, ...patch.custom },
    };
    expect(merged.enabled).toBe(true);
    expect(merged.custom.gain).toBe(3);
  });
});
