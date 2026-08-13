import { supabase } from "@/integrations/supabase/client";
import { removeObject } from "./storage";

export type StickerRow = {
  id: string;
  owner_id: string;
  path: string;
  emoji: string;
  created_at: string;
};

/** Semua stiker milik pengguna yang sedang login. */
export async function listStickers(ownerId: string): Promise<StickerRow[]> {
  const { data, error } = await supabase
    .from("stickers")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("Gagal memuat stiker");
  return (data ?? []) as StickerRow[];
}

/** Simpan stiker PNG transparan ke pustaka pribadi. */
export async function createSticker(
  ownerId: string,
  blob: Blob,
  emoji: string,
): Promise<StickerRow> {
  const path = `${ownerId}/${crypto.randomUUID()}.png`;
  const up = await supabase.storage.from("stickers").upload(path, blob, {
    contentType: "image/png",
    upsert: false,
  });
  if (up.error) throw new Error("Stiker gagal diunggah");
  const { data, error } = await supabase
    .from("stickers")
    .insert({ owner_id: ownerId, path, emoji })
    .select("*")
    .single();
  if (error) {
    await removeObject("stickers", path);
    throw new Error("Stiker gagal disimpan");
  }
  return data as StickerRow;
}

export async function deleteSticker(sticker: StickerRow): Promise<void> {
  const { error } = await supabase.from("stickers").delete().eq("id", sticker.id);
  if (error) throw new Error("Stiker gagal dihapus");
  await removeObject("stickers", sticker.path);
}

/** Ambil isi berkas stiker untuk dikirim ulang sebagai lampiran pesan. */
export async function downloadSticker(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from("stickers").download(path);
  if (error || !data) throw new Error("Stiker tidak dapat dibuka");
  return data;
}
