import type { VoiceParams, VoicePrefs } from "./presets";

export type VoiceSettingsPatch = Omit<Partial<VoicePrefs>, "custom"> & {
  custom?: Partial<VoiceParams>;
};

/** Send only fields the user edited; keep concurrent changes on other devices. */
export function changedVoicePrefs(base: VoicePrefs, next: VoicePrefs): VoiceSettingsPatch {
  const patch: VoiceSettingsPatch = {};
  if (base.enabled !== next.enabled) patch.enabled = next.enabled;
  if (base.preset !== next.preset) patch.preset = next.preset;
  if (base.intensity !== next.intensity) patch.intensity = next.intensity;
  for (const key of Object.keys(next.custom) as (keyof VoiceParams)[]) {
    if (base.custom[key] !== next.custom[key]) {
      patch.custom ??= {};
      patch.custom[key] = next.custom[key];
    }
  }
  return patch;
}
