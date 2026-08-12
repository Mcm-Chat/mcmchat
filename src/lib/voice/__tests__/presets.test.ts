import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_PREFS,
  LIMITS,
  NEUTRAL,
  PRESETS,
  applyIntensity,
  clampParams,
  effectiveParams,
  normalizePrefs,
} from "../presets";

describe("voice presets", () => {
  it("default OFF — efek tidak pernah aktif diam-diam", () => {
    expect(DEFAULT_VOICE_PREFS.enabled).toBe(false);
    expect(effectiveParams(DEFAULT_VOICE_PREFS)).toEqual({ ...NEUTRAL, denoise: 0 });
  });

  it("preset off menghasilkan audio normal", () => {
    expect(effectiveParams({ ...DEFAULT_VOICE_PREFS, enabled: true, preset: "off" })).toEqual({ ...NEUTRAL, denoise: 0 });
  });

  it("membatasi parameter ekstrem ke rentang aman", () => {
    const p = clampParams({ pitch: 99, formant: -12, gain: 100, reverb: 5 });
    expect(p.pitch).toBe(LIMITS.pitch.max);
    expect(p.formant).toBe(LIMITS.formant.min);
    expect(p.gain).toBe(LIMITS.gain.max);
    expect(p.reverb).toBe(LIMITS.reverb.max);
  });

  it("intensitas 0 mengembalikan karakter ke netral", () => {
    const deep = PRESETS.find((p) => p.id === "deep")!;
    const scaled = applyIntensity(deep.params, 0);
    expect(scaled.pitch).toBe(0);
    expect(scaled.formant).toBe(0);
  });

  it("tidak ada preset yang menyimpang di luar batas privasi", () => {
    for (const preset of PRESETS) {
      expect(Math.abs(preset.params.pitch)).toBeLessThanOrEqual(LIMITS.pitch.max);
      expect(clampParams(preset.params)).toEqual(preset.params);
    }
  });

  it("tidak menyediakan preset kloning/peniruan individu", () => {
    const ids = PRESETS.map((p) => p.id).join(",");
    expect(ids).not.toMatch(/clone|impersonat|celebrit|gender|age/i);
  });

  it("normalisasi menolak preset tak dikenal dan nilai rusak", () => {
    const prefs = normalizePrefs({ preset: "hack" as never, intensity: Number.NaN, enabled: true });
    expect(prefs.preset).toBe(DEFAULT_VOICE_PREFS.preset);
    expect(prefs.intensity).toBe(DEFAULT_VOICE_PREFS.intensity);
  });
});
