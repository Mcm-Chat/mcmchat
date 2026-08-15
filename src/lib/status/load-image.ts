/** Pemuat gambar status: dekode aman + perkecil sumber agar editor tetap ringan. */

const decodeViaUrl = (file: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gambar tidak bisa dibaca"));
    };
    img.src = url;
  });

const sizeOf = (src: ImageBitmap | HTMLImageElement) =>
  "naturalWidth" in src
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };

/**
 * Foto kamera ponsel bisa 12MP+; menggambarnya berulang kali ke kanvas
 * 1080x1920 membuat editor tersendat dan pada sebagian perangkat gagal total
 * (pratinjau hitam). Sumber selalu dinormalkan dulu ke ukuran wajar.
 */
export async function loadEditableImage(file: Blob, maxSide = 1600): Promise<HTMLImageElement> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  if (typeof createImageBitmap === "function") {
    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      source = null;
    }
  }
  if (!source) source = await decodeViaUrl(file);

  const { w, h } = sizeOf(source);
  if (!w || !h) throw new Error("Gambar tidak bisa dibaca");

  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gambar tidak bisa diproses");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new Error("Gambar tidak bisa diproses");
  return decodeViaUrl(blob);
}

/** Perangkat kelas bawah otomatis memakai pratinjau ringan. */
export function detectPerfMode(): "quality" | "performance" {
  if (typeof navigator === "undefined") return "quality";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  return mem <= 4 || cores <= 4 ? "performance" : "quality";
}
