/**
 * Foto profil MCM: penyimpanan atomik, privasi audiens, dan resolver URL.
 *
 * Aturan penting: berkas hasil edit hanya menjadi foto aktif setelah
 * `profiles.avatar_url` berhasil diperbarui. Jika update gagal, berkas baru
 * dibersihkan dan avatar lama tetap aktif.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import { removeObject, signedUrl } from "./storage";
import { avatarObjectPath } from "@/lib/media/image-validate";
import { getActiveUserId } from "@/lib/session-scope";

export type AvatarPrivacy = "contacts" | "contacts_except" | "only_share" | "nobody";

export const AVATAR_PRIVACY_LABEL: Record<AvatarPrivacy, string> = {
  contacts: "Kontak saya",
  contacts_except: "Kontak saya kecuali…",
  only_share: "Hanya bagikan dengan…",
  nobody: "Tidak seorang pun",
};

export type AvatarRef = { path: string | null; version: number };

/** Simpan avatar baru secara atomik. Mengembalikan referensi avatar aktif. */
export async function commitAvatar(userId: string, blob: Blob): Promise<AvatarRef> {
  // Versi ditentukan server; slot berkas dibuat unik agar tidak bentrok bila
  // dua perangkat mengunggah bersamaan.
  const path = avatarObjectPath(userId, Date.now());

  const up = await supabase.storage.from("avatars").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (up.error) throw new Error("Gagal mengunggah foto. Periksa koneksi lalu coba lagi.");

  const { data, error } = await supabase.rpc("commit_my_avatar", { _path: path });
  if (error) {
    // rollback: buang berkas baru, avatar lama tetap aktif
    await removeObject("avatars", path).catch(() => undefined);
    throw new Error(friendly(error.message, "Gagal memasang foto profil"));
  }
  const res = (data ?? {}) as { version?: number; previous_path?: string | null };

  // baru setelah profil sukses, avatar lama dihapus
  if (res.previous_path && res.previous_path !== path) {
    await removeObject("avatars", res.previous_path).catch(() => undefined);
  }
  invalidateAvatar(userId);
  return { path, version: res.version ?? 0 };
}

/** Hapus foto profil aktif (kembali ke inisial). */
export async function removeAvatar(userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("remove_my_avatar");
  if (error) throw new Error(friendly(error.message, "Gagal menghapus foto profil"));
  const prev = (data as { previous_path?: string | null } | null)?.previous_path;
  if (prev) await removeObject("avatars", prev).catch(() => undefined);
  invalidateAvatar(userId);
}

/* ------------------------------- privasi -------------------------------- */

export async function setAvatarPrivacy(_userId: string, privacy: AvatarPrivacy): Promise<void> {
  const { error } = await supabase.rpc("set_my_avatar_privacy", { _privacy: privacy });
  if (error) throw new Error(friendly(error.message, "Gagal menyimpan privasi foto profil"));
}

export type AudienceMode = "except" | "only";

export async function listAvatarAudience(userId: string, mode: AudienceMode): Promise<string[]> {
  const rows = unwrap(
    await supabase
      .from("avatar_audience")
      .select("target_id")
      .eq("owner_id", userId)
      .eq("mode", mode),
    "Gagal memuat daftar audiens",
  );
  return rows.map((r) => r.target_id);
}

export async function setAvatarAudience(
  userId: string,
  mode: AudienceMode,
  targets: string[],
): Promise<void> {
  const del = await supabase
    .from("avatar_audience")
    .delete()
    .eq("owner_id", userId)
    .eq("mode", mode);
  if (del.error) throw new Error(friendly(del.error.message, "Gagal menyimpan audiens"));
  if (targets.length === 0) return;
  const ins = await supabase
    .from("avatar_audience")
    .insert(targets.map((target_id) => ({ owner_id: userId, target_id, mode })));
  if (ins.error) throw new Error(friendly(ins.error.message, "Gagal menyimpan audiens"));
}

/**
 * Simpan mode privasi berbasis daftar + audiensnya dalam satu transaksi DB.
 *
 * Mode aktif hanya berubah bila daftar audiens juga tersimpan. Bila validasi
 * gagal (target bukan kontak, atau `only_share` kosong tanpa konfirmasi),
 * tidak ada perubahan sama sekali di server.
 */
export async function saveAvatarPrivacyAudience(
  privacy: Extract<AvatarPrivacy, "contacts_except" | "only_share">,
  targets: string[],
  confirmEmptyOnlyShare = false,
): Promise<number> {
  const { data, error } = await supabase.rpc("set_avatar_privacy_audience", {
    _privacy: privacy,
    _targets: targets,
    _confirm_empty_only_share: confirmEmptyOnlyShare,
  });
  if (error) throw new Error(friendly(error.message, "Gagal menyimpan privasi foto profil"));
  const count = (data as { count?: number } | null)?.count;
  return typeof count === "number" ? count : targets.length;
}

/* ------------------------------- resolver ------------------------------- */

type CacheEntry = { url: string | null; version: number; exp: number };
const avatarCache = new Map<string, CacheEntry>();
const listeners = new Set<(userId: string) => void>();

export function onAvatarChanged(fn: (userId: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function cacheKey(ownerId: string) {
  return `${getActiveUserId() ?? "anon"}:${ownerId}`;
}

export function invalidateAvatar(userId: string) {
  avatarCache.delete(cacheKey(userId));
  for (const fn of listeners) fn(userId);
}

/**
 * Resolver terpusat: satu signed URL per (user, versi) dipakai bersama semua
 * komponen, sehingga tidak ada badai permintaan signed URL.
 */
export async function resolveAvatarUrl(
  userId: string,
  path: string | null,
  version: number,
): Promise<string | null> {
  if (!path) return null;
  const key = cacheKey(userId);
  const hit = avatarCache.get(key);
  if (hit && hit.version === version && hit.exp > Date.now()) return hit.url;
  const url = await signedUrl("avatars", path, 900);
  avatarCache.set(key, { url, version, exp: Date.now() + 12 * 60 * 1000 });
  return url;
}

export function __resetAvatarCache() {
  avatarCache.clear();
}
