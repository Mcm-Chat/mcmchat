/** Reducer editor status (murni, tanpa DOM) dengan riwayat undo/redo. */

export type Point = { x: number; y: number };

export type StrokeLayer = {
  id: string;
  type: "stroke";
  tool: "pen" | "highlight" | "pixelate";
  color: string;
  width: number;
  points: Point[];
};

export type TextLayer = {
  id: string;
  type: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  bubble: boolean;
  font: string;
};

export type StickerLayer = {
  id: string;
  type: "sticker";
  emoji: string;
  x: number;
  y: number;
  size: number;
};

export type Layer = StrokeLayer | TextLayer | StickerLayer;

export type Adjust = { brightness: number; contrast: number; saturation: number };

export const FILTERS = [
  { id: "none", label: "Asli", css: "" },
  { id: "vivid", label: "Cerah", css: "saturate(1.35) contrast(1.08)" },
  { id: "warm", label: "Hangat", css: "sepia(0.25) saturate(1.2)" },
  { id: "cool", label: "Sejuk", css: "hue-rotate(-12deg) saturate(1.1)" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.1)" },
  { id: "fade", label: "Lembut", css: "contrast(0.9) brightness(1.06) saturate(0.85)" },
] as const;

export type FilterId = (typeof FILTERS)[number]["id"];

export type EditorState = {
  layers: Layer[];
  filter: FilterId;
  adjust: Adjust;
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  past: Snapshot[];
  future: Snapshot[];
};

type Snapshot = Pick<EditorState, "layers" | "filter" | "adjust" | "rotation" | "flipH">;

export type EditorAction =
  | { type: "add"; layer: Layer }
  | { type: "update"; id: string; patch: Partial<Layer> }
  | { type: "appendPoint"; id: string; point: Point }
  | { type: "remove"; id: string }
  | { type: "filter"; filter: FilterId }
  | { type: "adjust"; patch: Partial<Adjust> }
  | { type: "rotate" }
  | { type: "flip" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

export const initialAdjust: Adjust = { brightness: 1, contrast: 1, saturation: 1 };

export const initialEditor: EditorState = {
  layers: [],
  filter: "none",
  adjust: initialAdjust,
  rotation: 0,
  flipH: false,
  past: [],
  future: [],
};

const snap = (s: EditorState): Snapshot => ({
  layers: s.layers,
  filter: s.filter,
  adjust: s.adjust,
  rotation: s.rotation,
  flipH: s.flipH,
});

const push = (s: EditorState, next: Partial<Snapshot>): EditorState => ({
  ...s,
  ...next,
  past: [...s.past, snap(s)].slice(-40),
  future: [],
});

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "add":
      return push(state, { layers: [...state.layers, action.layer] });
    case "update":
      return push(state, {
        layers: state.layers.map((l) =>
          l.id === action.id ? ({ ...l, ...action.patch } as Layer) : l,
        ),
      });
    // Titik goresan ditambah tanpa menyentuh riwayat: satu goresan = satu undo.
    case "appendPoint":
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.id && l.type === "stroke"
            ? { ...l, points: [...l.points, action.point] }
            : l,
        ),
      };
    case "remove":
      return push(state, { layers: state.layers.filter((l) => l.id !== action.id) });
    case "filter":
      return push(state, { filter: action.filter });
    case "adjust":
      return push(state, { adjust: { ...state.adjust, ...action.patch } });
    case "rotate":
      return push(state, { rotation: ((state.rotation + 90) % 360) as EditorState["rotation"] });
    case "flip":
      return push(state, { flipH: !state.flipH });
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        ...prev,
        past: state.past.slice(0, -1),
        future: [snap(state), ...state.future].slice(0, 40),
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        ...next,
        past: [...state.past, snap(state)],
        future: state.future.slice(1),
      };
    }
    case "reset":
      return { ...initialEditor };
    default:
      return state;
  }
}

export const canUndo = (s: EditorState) => s.past.length > 0;
export const canRedo = (s: EditorState) => s.future.length > 0;

/** Gabungan filter preset + penyetelan manual untuk `ctx.filter`/CSS. */
export function filterCss(state: Pick<EditorState, "filter" | "adjust">): string {
  const preset = FILTERS.find((f) => f.id === state.filter)?.css ?? "";
  const { brightness, contrast, saturation } = state.adjust;
  const manual = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
  return `${preset} ${manual}`.trim();
}
