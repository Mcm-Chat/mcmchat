import { supabase } from "@/integrations/supabase/client";

export type UploadResult = { path: string; mime: string; size: number; name: string };

async function upload(bucket: string, path: string, file: Blob, name: string): Promise<UploadResult> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error("Gagal mengunggah berkas. Coba lagi.");
  return { path, mime: file.type || "application/octet-stream", size: file.size, name };
}

export function uploadChatMedia(conversationId: string, file: Blob, name: string) {
  const ext = name.includes(".") ? name.split(".").pop() : "jpg";
  return upload("chat-media", `${conversationId}/${crypto.randomUUID()}.${ext}`, file, name);
}

export function uploadProductPhoto(businessId: string, file: Blob, name: string) {
  const ext = name.includes(".") ? name.split(".").pop() : "jpg";
  return upload("product-photos", `${businessId}/${crypto.randomUUID()}.${ext}`, file, name);
}

const cache = new Map<string, { url: string; exp: number }>();

/** URL bertanda tangan dengan cache singkat agar tidak memanggil API berulang. */
export async function signedUrl(bucket: string, path: string, seconds = 3600): Promise<string | null> {
  const key = `${bucket}:${path}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) return null;
  cache.set(key, { url: data.signedUrl, exp: Date.now() + (seconds - 60) * 1000 });
  return data.signedUrl;
}

export async function removeObject(bucket: string, path: string) {
  await supabase.storage.from(bucket).remove([path]);
}
