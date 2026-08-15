/** Perenderan editor status ke kanvas (khusus browser). */
import { filterCss, type EditorState, type Layer } from "./editor";
import type { TextMeta } from "./model";

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/**
 * Cache lapisan dasar (foto + filter + rotasi) supaya menggambar ulang saat
 * mencoret/menggeser tidak perlu memfilter ulang gambar 1080x1920 tiap frame —
 * inilah sumber utama pratinjau tersendat.
 */
export type SceneCache = {
  key: string;
  base: HTMLCanvasElement | null;
  pixel: HTMLCanvasElement | null;
};

export const createSceneCache = (): SceneCache => ({ key: "", base: null, pixel: null });

const baseKey = (image: HTMLImageElement, state: EditorState) =>
  [
    image.src.length,
    image.naturalWidth,
    image.naturalHeight,
    state.rotation,
    state.flipH ? 1 : 0,
    state.filter,
    state.adjust.brightness,
    state.adjust.contrast,
    state.adjust.saturation,
  ].join("|");

export type Composed = { blob: Blob; thumb: Blob; width: number; height: number };

function drawStroke(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { type: "stroke" }>,
  pixelated: HTMLCanvasElement | null,
) {
  if (layer.points.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = layer.width;
  if (layer.tool === "pixelate" && pixelated) {
    // Sensor: goresan dipakai sebagai kliping untuk versi gambar beresolusi rendah.
    ctx.beginPath();
    ctx.moveTo(layer.points[0]!.x, layer.points[0]!.y);
    for (const p of layer.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#000";
    ctx.globalCompositeOperation = "source-over";
    ctx.stroke();
    ctx.clip();
    ctx.drawImage(pixelated, 0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
    return;
  }
  ctx.globalAlpha = layer.tool === "highlight" ? 0.35 : 1;
  ctx.strokeStyle = layer.color;
  ctx.beginPath();
  ctx.moveTo(layer.points[0]!.x, layer.points[0]!.y);
  for (const p of layer.points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { type: "text" }>) {
  ctx.save();
  ctx.font = `700 ${layer.size}px ${layer.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = layer.text.split("\n");
  const lh = layer.size * 1.2;
  if (layer.bubble) {
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + layer.size * 0.8;
    const h = lh * lines.length + layer.size * 0.4;
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    const r = layer.size * 0.4;
    const x = layer.x - w / 2;
    const y = layer.y - h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  ctx.fillStyle = layer.color;
  lines.forEach((line, i) =>
    ctx.fillText(line, layer.x, layer.y - ((lines.length - 1) * lh) / 2 + i * lh),
  );
  ctx.restore();
}

function pixelatedCopy(img: CanvasImageSource): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = 48;
  small.height = 85;
  const sctx = small.getContext("2d")!;
  sctx.drawImage(img, 0, 0, small.width, small.height);
  const out = document.createElement("canvas");
  out.width = CANVAS_W;
  out.height = CANVAS_H;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, CANVAS_W, CANVAS_H);
  return out;
}

function shade(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount))),
  );
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

/** Panah modern bergaya 3D: bayangan jatuh, badan bergradien, sorotan atas. */
function drawArrow(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { type: "arrow" }>) {
  const { x1, y1, x2, y2 } = layer;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 4) return;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const w = Math.max(8, layer.width);
  const head = Math.min(len * 0.45, w * 3.2);
  const body = Math.max(0, len - head);

  const path = new Path2D();
  path.moveTo(0, -w / 2);
  path.lineTo(body, -w / 2);
  path.lineTo(body, -w * 1.5);
  path.lineTo(len, 0);
  path.lineTo(body, w * 1.5);
  path.lineTo(body, w / 2);
  path.lineTo(0, w / 2);
  path.closePath();

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(ang);
  ctx.lineJoin = "round";

  // Bayangan jatuh memberi kesan mengambang di atas foto.
  ctx.save();
  ctx.translate(w * 0.28, w * 0.34);
  ctx.fillStyle = "rgba(2,6,23,0.38)";
  ctx.fill(path);
  ctx.restore();

  const grad = ctx.createLinearGradient(0, -w * 1.5, 0, w * 1.5);
  grad.addColorStop(0, shade(layer.color, 0.45));
  grad.addColorStop(0.45, layer.color);
  grad.addColorStop(1, shade(layer.color, -0.45));
  ctx.fillStyle = grad;
  ctx.fill(path);

  ctx.lineWidth = Math.max(2, w * 0.12);
  ctx.strokeStyle = shade(layer.color, -0.55);
  ctx.stroke(path);

  // Sorotan tipis di sisi atas badan panah.
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(2, w * 0.16);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(w * 0.2, -w * 0.22);
  ctx.lineTo(Math.max(w * 0.2, body - w * 0.2), -w * 0.22);
  ctx.stroke();
  ctx.restore();
}

function unusedPixelatedCopy(img: CanvasImageSource): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = 48;
  small.height = 85;
  const sctx = small.getContext("2d")!;
  sctx.drawImage(img, 0, 0, small.width, small.height);
  const out = document.createElement("canvas");
  out.width = CANVAS_W;
  out.height = CANVAS_H;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(small, 0, 0, CANVAS_W, CANVAS_H);
  return out;
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Gagal memproses gambar"))),
      "image/jpeg",
      quality,
    ),
  );

function renderBase(image: HTMLImageElement, state: EditorState): HTMLCanvasElement {
  const base = document.createElement("canvas");
  base.width = CANVAS_W;
  base.height = CANVAS_H;
  const ctx = base.getContext("2d")!;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const rotated = state.rotation === 90 || state.rotation === 270;
  const iw = rotated ? image.naturalHeight : image.naturalWidth;
  const ih = rotated ? image.naturalWidth : image.naturalHeight;
  const scale = Math.max(CANVAS_W / iw, CANVAS_H / ih);
  const dw = iw * scale;
  const dh = ih * scale;

  ctx.save();
  ctx.filter = filterCss(state);
  ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  if (state.flipH) ctx.scale(-1, 1);
  const drawW = rotated ? dh : dw;
  const drawH = rotated ? dw : dh;
  ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
  return base;
}

/** Gambar seluruh adegan ke konteks 1080x1920 — dipakai pratinjau dan ekspor. */
export function drawScene(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  state: EditorState,
  cache?: SceneCache,
) {
  const ctx = canvas.getContext("2d")!;
  // Pratinjau boleh memakai kanvas lebih kecil (mode performa); seluruh adegan
  // diskalakan agar koordinat lapisan tetap dalam ruang 1080x1920.
  const sx = canvas.width / CANVAS_W;
  const sy = canvas.height / CANVAS_H;
  const key = baseKey(image, state);
  let base: HTMLCanvasElement;
  if (cache && cache.base && cache.key === key) {
    base = cache.base;
  } else {
    base = renderBase(image, state);
    if (cache) {
      cache.key = key;
      cache.base = base;
      cache.pixel = null;
    }
  }

  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.drawImage(base, 0, 0);

  const hasPixelate = state.layers.some((l) => l.type === "stroke" && l.tool === "pixelate");
  let pixel: HTMLCanvasElement | null = null;
  if (hasPixelate) {
    pixel = cache?.pixel ?? pixelatedCopy(base);
    if (cache) cache.pixel = pixel;
  }
  for (const layer of state.layers) {
    if (layer.type === "stroke") drawStroke(ctx, layer, pixel);
    else if (layer.type === "text") drawText(ctx, layer);
    else if (layer.type === "arrow") drawArrow(ctx, layer);
    else {
      ctx.save();
      ctx.font = `${layer.size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(layer.emoji, layer.x, layer.y);
      ctx.restore();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/** Susun foto + filter + coretan + teks menjadi satu berkas 1080x1920. */
export async function composeStatus(
  image: HTMLImageElement,
  state: EditorState,
): Promise<Composed> {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  drawScene(canvas, image, state);

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 270;
  thumbCanvas.height = 480;
  thumbCanvas.getContext("2d")!.drawImage(canvas, 0, 0, 270, 480);

  return {
    blob: await toBlob(canvas, 0.86),
    thumb: await toBlob(thumbCanvas, 0.7),
    width: CANVAS_W,
    height: CANVAS_H,
  };
}

/** Status teks juga dirender menjadi gambar agar konsisten di semua perangkat. */
export function textStatusMeta(
  text: string,
  background: string,
  color: string,
  font: string,
): TextMeta {
  return { text, background, color, font, align: "center" };
}
