/**
 * Model murni (tanpa DOM) untuk editor foto profil MCM.
 *
 * Semua state editor berupa data serializable sehingga bisa diuji tanpa
 * browser. Rendering nyata ada di `image-pipeline.ts`.
 */

export type AspectPreset = "free" | "1:1" | "4:5" | "original";
export type FilterId = "original" | "vivid" | "warm" | "cool" | "mono";
export type MaskKind = "blur" | "pixelate";
export type BackgroundMode = "blur" | "color";

export type MaskRegion = {
  id: string;
  kind: MaskKind;
  /** Koordinat ternormalisasi 0..1 terhadap area crop. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type EditorState = {
  preset: AspectPreset;
  /** Crop ternormalisasi 0..1 terhadap gambar sumber (setelah rotasi/flip). */
  crop: { x: number; y: number; w: number; h: number };
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  filter: FilterId;
  masks: MaskRegion[];
  background: BackgroundMode;
  backgroundColor: string;
};

export const INITIAL_EDITOR_STATE: EditorState = {
  preset: "1:1",
  crop: { x: 0, y: 0, w: 1, h: 1 },
  zoom: 1,
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  filter: "original",
  masks: [],
  background: "blur",
  backgroundColor: "#0f1b2a",
};

export type EditorAction =
  | { type: "preset"; preset: AspectPreset }
  | { type: "crop"; crop: EditorState["crop"] }
  | { type: "zoom"; zoom: number }
  | { type: "rotate" }
  | { type: "flip"; axis: "h" | "v" }
  | { type: "adjust"; key: "brightness" | "contrast" | "saturation"; value: number }
  | { type: "filter"; filter: FilterId }
  | { type: "mask.add"; mask: MaskRegion }
  | { type: "mask.remove"; id: string }
  | { type: "mask.clear" }
  | { type: "background"; mode: BackgroundMode; color?: string };

export const ASPECT_RATIO: Record<AspectPreset, number | null> = {
  free: null,
  "1:1": 1,
  "4:5": 4 / 5,
  original: null,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampCrop(crop: EditorState["crop"]): EditorState["crop"] {
  const w = clamp(crop.w, 0.05, 1);
  const h = clamp(crop.h, 0.05, 1);
  return { w, h, x: clamp(crop.x, 0, 1 - w), y: clamp(crop.y, 0, 1 - h) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "preset":
      return { ...state, preset: action.preset, crop: clampCrop(state.crop) };
    case "crop":
      return { ...state, crop: clampCrop(action.crop) };
    case "zoom":
      return { ...state, zoom: clamp(action.zoom, 1, 4) };
    case "rotate":
      return { ...state, rotation: (((state.rotation + 90) % 360) as EditorState["rotation"]) };
    case "flip":
      return action.axis === "h" ? { ...state, flipH: !state.flipH } : { ...state, flipV: !state.flipV };
    case "adjust":
      return { ...state, [action.key]: clamp(action.value, 0, 200) } as EditorState;
    case "filter":
      return { ...state, filter: action.filter };
    case "mask.add":
      return { ...state, masks: [...state.masks, action.mask] };
    case "mask.remove":
      return { ...state, masks: state.masks.filter((m) => m.id !== action.id) };
    case "mask.clear":
      return { ...state, masks: [] };
    case "background":
      return { ...state, background: action.mode, backgroundColor: action.color ?? state.backgroundColor };
    default:
      return state;
  }
}

/* ------------------------------- history -------------------------------- */

export type EditorHistory = {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
};

export type HistoryAction = EditorAction | { type: "undo" } | { type: "redo" } | { type: "reset" };

const HISTORY_LIMIT = 40;

export function initHistory(state: EditorState = INITIAL_EDITOR_STATE): EditorHistory {
  return { past: [], present: state, future: [] };
}

export function historyReducer(history: EditorHistory, action: HistoryAction): EditorHistory {
  if (action.type === "undo") {
    const prev = history.past[history.past.length - 1];
    if (!prev) return history;
    return { past: history.past.slice(0, -1), present: prev, future: [history.present, ...history.future] };
  }
  if (action.type === "redo") {
    const next = history.future[0];
    if (!next) return history;
    return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
  }
  if (action.type === "reset") {
    if (isPristine(history.present)) return history;
    return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: INITIAL_EDITOR_STATE, future: [] };
  }
  const present = editorReducer(history.present, action);
  if (present === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present, future: [] };
}

export function canUndo(h: EditorHistory): boolean {
  return h.past.length > 0;
}
export function canRedo(h: EditorHistory): boolean {
  return h.future.length > 0;
}
export function isPristine(state: EditorState): boolean {
  return JSON.stringify(state) === JSON.stringify(INITIAL_EDITOR_STATE);
}
/** Draft dianggap “ada perubahan” bila state bukan default. */
export function isDirty(h: EditorHistory): boolean {
  return !isPristine(h.present) || h.past.length > 0;
}

/* ------------------------------- filters -------------------------------- */

export const FILTERS: { id: FilterId; label: string; css: string }[] = [
  { id: "original", label: "Original", css: "" },
  { id: "vivid", label: "Vivid", css: "saturate(1.35) contrast(1.12)" },
  { id: "warm", label: "Warm", css: "sepia(0.25) saturate(1.2) hue-rotate(-10deg)" },
  { id: "cool", label: "Cool", css: "saturate(1.05) hue-rotate(12deg) brightness(1.03)" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.08)" },
];

/** Gabungan filter CSS canvas untuk state saat ini. */
export function filterCss(state: EditorState): string {
  const preset = FILTERS.find((f) => f.id === state.filter)?.css ?? "";
  const base = [
    `brightness(${state.brightness / 100})`,
    `contrast(${state.contrast / 100})`,
    `saturate(${state.saturation / 100})`,
  ].join(" ");
  return preset ? `${base} ${preset}` : base;
}

/* ------------------------------ geometry -------------------------------- */

export const MAX_OUTPUT_PX = 1280;
/** Batas kanvas kerja agar HP Android kelas bawah tidak kehabisan memori. */
export const MAX_WORKING_PX = 2048;

export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Ukuran keluaran final berdasar rasio crop, dibatasi MAX_OUTPUT_PX. */
export function outputSize(state: EditorState, sourceW: number, sourceH: number): { width: number; height: number } {
  const swapped = state.rotation === 90 || state.rotation === 270;
  const baseW = (swapped ? sourceH : sourceW) * state.crop.w;
  const baseH = (swapped ? sourceW : sourceH) * state.crop.h;
  const ratio = ASPECT_RATIO[state.preset];
  if (ratio) {
    const side = Math.min(MAX_OUTPUT_PX, Math.max(baseW, baseH));
    return ratio === 1
      ? { width: Math.round(side), height: Math.round(side) }
      : { width: Math.round(side * ratio), height: Math.round(side) };
  }
  return fitWithin(baseW, baseH, MAX_OUTPUT_PX);
}

/** Crop terpusat sesuai rasio preset (dipakai saat preset berubah). */
export function centeredCrop(preset: AspectPreset, sourceW: number, sourceH: number): EditorState["crop"] {
  const ratio = ASPECT_RATIO[preset];
  if (!ratio || sourceW <= 0 || sourceH <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const targetPx = sourceW / sourceH > ratio ? { w: sourceH * ratio, h: sourceH } : { w: sourceW, h: sourceW / ratio };
  const w = targetPx.w / sourceW;
  const h = targetPx.h / sourceH;
  return { w, h, x: (1 - w) / 2, y: (1 - h) / 2 };
}