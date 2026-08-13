/**
 * Preset & parameter Voice Privacy (Efek Suara Premium) MCM.
 *
 * Prinsip desain:
 * - Efek bertujuan PRIVASI & KENYAMANAN, bukan penyamaran identitas.
 * - Tidak ada preset yang meniru individu, tokoh, gender, atau usia tertentu.
 * - Tidak ada voice cloning, tidak ada unggah sampel suara orang lain.
 * - Rentang parameter sengaja dibatasi agar suara tetap terdengar "seperti Anda,
 *   hanya berbeda warna" dan tidak bisa dipakai membobol verifikasi suara.
 */

export type VoiceParams = {
  /** Geser nada, semitone. Dibatasi ±5 semitone. */
  pitch: number;
  /** Geser formant (warna vokal), −1..1. */
  formant: number;
  /** Tone/EQ tilt: negatif = gelap/hangat, positif = terang. −1..1 */
  tone: number;
  /** Ambang noise gate dalam dB (−80..−20). */
  gate: number;
  /** Peredam derau latar 0..1 (0 = mati). */
  denoise: number;
  /** Gain keluaran dalam dB (−12..+12). */
  gain: number;
  /** Reverb ringan 0..0.4. */
  reverb: number;
  /** Karakter tambahan: distorsi radio / robot ringan 0..1. */
  character: number;
};

export type PresetId =
  "off" | "natural" | "deep" | "bright" | "warm" | "robot" | "radio" | "privacy" | "custom";

export type VoicePreset = {
  id: PresetId;
  name: string;
  desc: string;
  params: VoiceParams;
};

export const NEUTRAL: VoiceParams = {
  pitch: 0,
  formant: 0,
  tone: 0,
  gate: -60,
  denoise: 0.3,
  gain: 0,
  reverb: 0,
  character: 0,
};

export const LIMITS: Record<keyof VoiceParams, { min: number; max: number; step: number }> = {
  pitch: { min: -5, max: 5, step: 0.5 },
  formant: { min: -1, max: 1, step: 0.05 },
  tone: { min: -1, max: 1, step: 0.05 },
  gate: { min: -80, max: -20, step: 1 },
  denoise: { min: 0, max: 1, step: 0.05 },
  gain: { min: -12, max: 12, step: 0.5 },
  reverb: { min: 0, max: 0.4, step: 0.02 },
  character: { min: 0, max: 1, step: 0.05 },
};

export const PARAM_LABEL: Record<keyof VoiceParams, { label: string; hint: string }> = {
  pitch: { label: "Nada (pitch)", hint: "Naik/turunkan nada dalam batas aman ±5 semitone." },
  formant: { label: "Formant", hint: "Ubah warna vokal tanpa mengubah nada bicara." },
  tone: { label: "Tone / EQ", hint: "Geser dari hangat (gelap) ke terang (jernih)." },
  gate: { label: "Noise gate", hint: "Bisukan suara di bawah ambang agar ruangan senyap." },
  denoise: { label: "Peredam derau latar", hint: "Tekan derau kipas, AC, dan keramaian." },
  gain: { label: "Volume keluaran", hint: "Sesuaikan level suara Anda ke lawan bicara." },
  reverb: { label: "Reverb ringan", hint: "Sedikit ruang agar suara tidak terdengar kering." },
  character: { label: "Karakter", hint: "Sentuhan robot/radio ringan pada preset terkait." },
};

export const PRESETS: VoicePreset[] = [
  {
    id: "off",
    name: "Nonaktif",
    desc: "Suara asli tanpa pemrosesan. Ini setelan bawaan MCM.",
    params: { ...NEUTRAL, denoise: 0 },
  },
  {
    id: "natural",
    name: "Natural+",
    desc: "Suara Anda apa adanya, hanya lebih bersih dan seimbang.",
    params: { ...NEUTRAL, denoise: 0.45, gate: -55, gain: 1 },
  },
  {
    id: "deep",
    name: "Deep",
    desc: "Nada sedikit lebih rendah dan berisi untuk ruangan berisik.",
    params: { ...NEUTRAL, pitch: -2, formant: -0.25, tone: -0.25, denoise: 0.4 },
  },
  {
    id: "bright",
    name: "Bright",
    desc: "Artikulasi lebih jelas untuk sambungan data lemah.",
    params: { ...NEUTRAL, pitch: 1, formant: 0.2, tone: 0.4, denoise: 0.4, gain: 1 },
  },
  {
    id: "warm",
    name: "Warm",
    desc: "Nada hangat dan lembut, nyaman untuk panggilan panjang.",
    params: { ...NEUTRAL, tone: -0.35, reverb: 0.08, denoise: 0.4 },
  },
  {
    id: "robot",
    name: "Robot ringan",
    desc: "Sentuhan robotik halus. Tetap mudah dipahami lawan bicara.",
    params: { ...NEUTRAL, character: 0.45, tone: 0.1, denoise: 0.5 },
  },
  {
    id: "radio",
    name: "Radio / Walkie Talkie",
    desc: "Karakter pita sempit khas radio komunikasi.",
    params: { ...NEUTRAL, character: 0.6, tone: 0.3, gate: -45, denoise: 0.5 },
  },
  {
    id: "privacy",
    name: "Anonymous / Privacy",
    desc: "Menyamarkan karakter suara secara umum agar tidak mudah dikenali sekilas. Bukan alat untuk menyamar sebagai orang lain.",
    params: { ...NEUTRAL, pitch: -1.5, formant: 0.45, character: 0.3, tone: -0.1, denoise: 0.55 },
  },
  {
    id: "custom",
    name: "Custom",
    desc: "Atur sendiri nada, formant, tone, gate, denoise, volume, dan reverb.",
    params: { ...NEUTRAL, denoise: 0.4 },
  },
];

export const PRESET_MAP = new Map(PRESETS.map((p) => [p.id, p]));

export function clampParams(input: Partial<VoiceParams> | null | undefined): VoiceParams {
  const merged = { ...NEUTRAL, ...(input ?? {}) };
  const out = {} as VoiceParams;
  for (const key of Object.keys(NEUTRAL) as (keyof VoiceParams)[]) {
    const { min, max } = LIMITS[key];
    const value = Number(merged[key]);
    out[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : NEUTRAL[key];
  }
  return out;
}

/**
 * Intensitas 0..1 menskalakan seberapa jauh preset menyimpang dari suara asli.
 * Denoise, gate, dan gain tidak diskalakan karena bersifat kebersihan audio.
 */
export function applyIntensity(params: VoiceParams, intensity: number): VoiceParams {
  const k = Math.min(1, Math.max(0, intensity));
  return clampParams({
    ...params,
    pitch: params.pitch * k,
    formant: params.formant * k,
    tone: params.tone * k,
    reverb: params.reverb * k,
    character: params.character * k,
  });
}

export type VoicePrefs = {
  /** Default OFF — efek tidak pernah aktif diam-diam. */
  enabled: boolean;
  preset: PresetId;
  intensity: number;
  custom: VoiceParams;
};

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  enabled: false,
  preset: "natural",
  intensity: 0.7,
  custom: { ...NEUTRAL, denoise: 0.4 },
};

export function normalizePrefs(input: Partial<VoicePrefs> | null | undefined): VoicePrefs {
  const preset = PRESET_MAP.has(input?.preset as PresetId)
    ? (input?.preset as PresetId)
    : DEFAULT_VOICE_PREFS.preset;
  const intensity = Number(input?.intensity);
  return {
    enabled: Boolean(input?.enabled),
    preset,
    intensity: Number.isFinite(intensity)
      ? Math.min(1, Math.max(0, intensity))
      : DEFAULT_VOICE_PREFS.intensity,
    custom: clampParams(input?.custom),
  };
}

/** Parameter efektif yang dikirim ke pipeline audio. */
export function effectiveParams(prefs: VoicePrefs): VoiceParams {
  if (!prefs.enabled || prefs.preset === "off") return { ...NEUTRAL, denoise: 0 };
  const base =
    prefs.preset === "custom" ? prefs.custom : (PRESET_MAP.get(prefs.preset)?.params ?? NEUTRAL);
  return prefs.preset === "custom" ? clampParams(base) : applyIntensity(base, prefs.intensity);
}
