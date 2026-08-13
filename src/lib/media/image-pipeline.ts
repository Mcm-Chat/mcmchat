/**
 * Pipeline rendering foto profil (browser only).
 *
 * - Orientasi EXIF dikoreksi lewat `createImageBitmap({ imageOrientation })`.
 * - Hasil akhir dirender ulang ke kanvas dan dikeluarkan sebagai JPEG,
 *   sehingga seluruh metadata EXIF/GPS asli hilang.
 */
import {
  ASPECT_RATIO,
  MAX_WORKING_PX,
  fitWithin,
  filterCss,
  outputSize,
  type EditorState,
  type MaskRegion,
} from "./image-editor";

export type LoadedImage = { bitmap: ImageBitmap; width: number; height: number; dispose: () => void };

/** Muat berkas menjadi bitmap dengan orientasi EXIF sudah dikoreksi. */
export async function loadImage(file: Blob): Promise<LoadedImage> {
  const raw = await createImageBitmap(file, { imageOrientation: "from-image" });
  const fitted = fitWithin(raw.width, raw.height, MAX_WORKING_PX);
  if (fitted.width === raw.width && fitted.height === raw.height) {
    return { bitmap: raw, width: raw.width, height: raw.height, dispose: () => raw.close() };
  }
  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kanvas tidak tersedia di perangkat ini.");
  ctx.drawImage(raw, 0, 0, fitted.width, fitted.height);
  raw.close();
  const scaled = await createImageBitmap(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return { bitmap: scaled, width: fitted.width, height: fitted.height, dispose: () => scaled.close() };
}

function drawMask(ctx: CanvasRenderingContext2D, mask: MaskRegion, w: number, h: number) {
  const x = mask.x * w;
  const y = mask.y * h;
  const mw = Math.max(1, mask.w * w);
  const mh = Math.max(1, mask.h * h);
  const region = ctx.getImageData(x, y, mw, mh);
  const tmp = document.createElement("canvas");
  tmp.width = mw;
  tmp.height = mh;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.putImageData(region, 0, 0);
  ctx.save();
  if (mask.kind === "blur") {
    ctx.filter = `blur(${Math.max(6, Math.min(mw, mh) / 6)}px)`;
    ctx.drawImage(tmp, x, y, mw, mh);
  } else {
    const px = Math.max(4, Math.round(Math.min(mw, mh) / 10));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(mw / px));
    small.height = Math.max(1, Math.round(mh / px));
    const sctx = small.getContext("2d");
    if (sctx) {
      sctx.drawImage(tmp, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width, small.height, x, y, mw, mh);
    }
    small.width = 0;
    small.height = 0;
  }
  ctx.restore();
  tmp.width = 0;
  tmp.height = 0;
}

/** Render state editor ke kanvas baru (dipakai untuk preview dan hasil akhir). */
export function renderToCanvas(img: LoadedImage, state: EditorState): HTMLCanvasElement {
  const out = outputSize(state, img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kanvas tidak tersedia di perangkat ini.");

  // latar untuk foto yang tidak memenuhi rasio
  if (state.background === "color") {
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
  } else {
    ctx.save();
    ctx.filter = "blur(24px)";
    ctx.drawImage(img.bitmap, -out.width * 0.1, -out.height * 0.1, out.width * 1.2, out.height * 1.2);
    ctx.restore();
  }

  const swapped = state.rotation === 90 || state.rotation === 270;
  const srcW = swapped ? img.height : img.width;
  const srcH = swapped ? img.width : img.height;
  const cropW = srcW * state.crop.w;
  const cropH = srcH * state.crop.h;
  const ratio = ASPECT_RATIO[state.preset] ?? cropW / cropH;
  const scale = Math.min(out.width / cropW, out.height / cropH) * state.zoom;
  const drawW = cropW * scale;
  const drawH = cropH * scale;

  ctx.save();
  ctx.filter = filterCss(state);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  const sx = state.crop.x * img.width;
  const sy = state.crop.y * img.height;
  const sw = img.width * state.crop.w;
  const sh = img.height * state.crop.h;
  const dw = swapped ? drawH : drawW;
  const dh = swapped ? drawW : drawH;
  ctx.drawImage(img.bitmap, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  void ratio;

  for (const mask of state.masks) drawMask(ctx, mask, out.width, out.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Gagal membuat berkas foto."))),
      "image/jpeg",
      quality,
    );
  });
}

/** Render final + kompresi adaptif. Hasil selalu JPEG tanpa metadata asli. */
export async function renderFinalBlob(img: LoadedImage, state: EditorState): Promise<Blob> {
  const canvas = renderToCanvas(img, state);
  let quality = 0.86;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > 400 * 1024 && quality > 0.55) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}