/** Validasi berkas gambar: MIME nyata (magic bytes), ekstensi, ukuran. */

export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

export type ValidationResult = { ok: true; mime: AllowedMime } | { ok: false; error: string };

/** Deteksi tipe dari magic bytes, bukan dari nama berkas atau `file.type`. */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === "RIFF" &&
    String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function extensionAllowed(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ["jpg", "jpeg", "png", "webp"].includes(ext);
}

export async function validateImageFile(
  file: File | Blob,
  name?: string,
): Promise<ValidationResult> {
  if (file.size === 0) return { ok: false, error: "Berkas kosong." };
  if (file.size > MAX_INPUT_BYTES) return { ok: false, error: "Ukuran foto melebihi 12 MB." };
  const fileName = name ?? (file instanceof File ? file.name : "");
  if (fileName && !extensionAllowed(fileName))
    return { ok: false, error: "Format berkas tidak didukung." };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffMime(head);
  if (!mime) return { ok: false, error: "Berkas bukan gambar JPEG/PNG/WebP yang valid." };
  return { ok: true, mime };
}

/** Nama objek avatar baru: selalu path milik user + versi baru. */
export function avatarObjectPath(userId: string, version: number): string {
  return `${userId}/avatar-v${version}-${crypto.randomUUID()}.jpg`;
}
