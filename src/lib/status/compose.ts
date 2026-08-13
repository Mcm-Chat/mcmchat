/** Perenderan editor status ke kanvas (khusus browser). */
import { filterCss, type EditorState, type Layer } from "./editor";
import type { TextMeta } from "./model";

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

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

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Gagal memproses gambar"))),
      "image/jpeg",
      quality,
    ),
  );

/** Gambar seluruh adegan ke konteks 1080x1920 — dipakai pratinjau dan ekspor. */
export function drawScene(canvas: HTMLCanvasElement, image: HTMLImageElement, state: EditorState) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
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

  const hasPixelate = state.layers.some((l) => l.type === "stroke" && l.tool === "pixelate");
  const pixel = hasPixelate ? pixelatedCopy(canvas) : null;
  for (const layer of state.layers) {
    if (layer.type === "stroke") drawStroke(ctx, layer, pixel);
    else if (layer.type === "text") drawText(ctx, layer);
    else {
      ctx.save();
      ctx.font = `${layer.size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(layer.emoji, layer.x, layer.y);
      ctx.restore();
    }
  }

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
