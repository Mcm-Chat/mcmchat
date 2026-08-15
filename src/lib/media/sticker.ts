/** Perenderan stiker: kanvas 512x512 transparan ala WhatsApp. */
export const STICKER_SIZE = 512;

export type StickerEdit = {
  /** Skala tampilan gambar (1 = pas kotak). */
  scale: number;
  /** Geser horizontal/vertikal dalam piksel kanvas. */
  offsetX: number;
  offsetY: number;
  /** Hapus latar berdasarkan warna sudut gambar. */
  removeBackground: boolean;
  /** Toleransi 0-100 untuk penghapusan latar. */
  tolerance: number;
  /** Garis tepi putih ala stiker. */
  outline: boolean;
  /** Teks opsional di bagian bawah. */
  caption: string;
};

export const defaultStickerEdit: StickerEdit = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  removeBackground: false,
  tolerance: 24,
  outline: true,
  caption: "",
};

export async function loadStickerImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Gambar tidak dapat dibaca"));
      img.src = url;
    });
    return img;
  } finally {
    // URL dilepas setelah gambar didekode oleh browser.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function stripBackground(ctx: CanvasRenderingContext2D, tolerance: number) {
  const size = STICKER_SIZE;
  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  const at = (x: number, y: number) => {
    const i = (y * size + x) * 4;
    return [px[i]!, px[i + 1]!, px[i + 2]!] as const;
  };
  const corners = [at(2, 2), at(size - 3, 2), at(2, size - 3), at(size - 3, size - 3)];
  const base = [0, 1, 2].map((c) => corners.reduce((s, k) => s + k[c]!, 0) / corners.length);
  const limit = (tolerance / 100) * 442; // jarak RGB maksimum
  for (let i = 0; i < px.length; i += 4) {
    const d = Math.sqrt(
      (px[i]! - base[0]!) ** 2 + (px[i + 1]! - base[1]!) ** 2 + (px[i + 2]! - base[2]!) ** 2,
    );
    if (d <= limit) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
}

function drawOutline(source: HTMLCanvasElement): HTMLCanvasElement {
  const size = STICKER_SIZE;
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d")!;
  const r = 10;
  ctx.save();
  ctx.filter = "drop-shadow(0 0 0 #ffffff)";
  for (let a = 0; a < 360; a += 24) {
    const rad = (a * Math.PI) / 180;
    ctx.drawImage(source, Math.cos(rad) * r, Math.sin(rad) * r);
  }
  ctx.restore();
  // Siluet hasil sapuan diputihkan, lalu gambar asli ditimpa di atasnya.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(source, 0, 0);
  return out;
}

export function renderSticker(img: HTMLImageElement, edit: StickerEdit): HTMLCanvasElement {
  const size = STICKER_SIZE;
  const base = document.createElement("canvas");
  base.width = size;
  base.height = size;
  const ctx = base.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);

  const ratio = Math.min(size / img.naturalWidth, size / img.naturalHeight) * edit.scale;
  const w = img.naturalWidth * ratio;
  const h = img.naturalHeight * ratio;
  ctx.drawImage(img, (size - w) / 2 + edit.offsetX, (size - h) / 2 + edit.offsetY, w, h);

  if (edit.removeBackground) stripBackground(ctx, edit.tolerance);

  const withOutline = edit.outline ? drawOutline(base) : base;

  const final = document.createElement("canvas");
  final.width = size;
  final.height = size;
  const fctx = final.getContext("2d")!;
  fctx.drawImage(withOutline, 0, 0);

  const caption = edit.caption.trim();
  if (caption) {
    fctx.font = "bold 56px system-ui, sans-serif";
    fctx.textAlign = "center";
    fctx.textBaseline = "bottom";
    fctx.lineJoin = "round";
    fctx.lineWidth = 14;
    fctx.strokeStyle = "#ffffff";
    fctx.fillStyle = "#111827";
    fctx.strokeText(caption, size / 2, size - 24, size - 40);
    fctx.fillText(caption, size / 2, size - 24, size - 40);
  }
  return final;
}

export function stickerToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Stiker gagal dibuat"))), "image/png");
  });
}
