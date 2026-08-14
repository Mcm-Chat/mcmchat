/**
 * Resolver profil aman (Tahap 2A).
 *
 * Semua pembacaan profil orang lain melewati RPC `profile_cards` (kartu
 * minimal: id, nama, warna, avatar bila lolos privasi) atau `profile_full`
 * (hanya self / kontak mutual / percakapan bersama / rekan bisnis).
 * Tidak ada lagi `.from("profiles").select(...)` bebas di klien.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendly } from "./db";

export type ProfileCard = {
  id: string;
  display_name: string;
  avatar_color: string;
  avatar_url: string | null;
  avatar_version: number;
};

export type FullProfile = ProfileCard & {
  /** PIN hanya diisi untuk diri sendiri atau hubungan aktif yang diterima. */
  pin: string | null;
  bio: string;
  /** Hanya diisi untuk diri sendiri. */
  avatar_privacy: string | null;
  is_online: boolean;
  last_seen_at: string;
};

const EMPTY = new Map<string, ProfileCard>();

/** Batch kartu profil (anti N+1). Aman dipanggil dengan id duplikat. */
export async function fetchProfileCards(ids: string[]): Promise<Map<string, ProfileCard>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map(EMPTY);
  const { data, error } = await supabase.rpc("profile_cards", { _ids: unique });
  if (error) throw new Error(friendly(error.message, "Gagal memuat profil"));
  return new Map(
    (data ?? []).map((p) => [
      p.id,
      {
        id: p.id,
        display_name: p.display_name,
        avatar_color: p.avatar_color,
        avatar_url: p.avatar_url,
        avatar_version: p.avatar_version ?? 0,
      } satisfies ProfileCard,
    ]),
  );
}

export async function fetchProfileCard(id: string): Promise<ProfileCard | null> {
  return (await fetchProfileCards([id])).get(id) ?? null;
}

/** Profil lengkap orang lain — hanya bila hubungan mengizinkan. */
export async function fetchFullProfile(id: string): Promise<FullProfile | null> {
  const { data, error } = await supabase.rpc("profile_full", { _id: id });
  if (error) throw new Error(friendly(error.message, "Gagal memuat profil"));
  const row = data?.[0];
  return row ? ({ ...row, avatar_version: row.avatar_version ?? 0 } as FullProfile) : null;
}

/** Profil sendiri (seluruh kolom milik auth.uid()). */
export async function fetchMyProfile() {
  const { data, error } = await supabase.rpc("my_profile");
  if (error) throw new Error(friendly(error.message, "Gagal memuat profil"));
  return data ?? null;
}

/** Ubah nama/bio sendiri — divalidasi server (trim, panjang, karakter). */
export async function updateMyProfile(displayName: string, bio: string) {
  const { data, error } = await supabase.rpc("update_my_profile", {
    _display_name: displayName,
    _bio: bio,
  });
  if (error) {
    const map: Record<string, string> = {
      invalid_display_name: "Nama harus 2–40 karakter.",
      invalid_bio: "Bio maksimal 160 karakter.",
      invalid_characters: "Nama/bio mengandung karakter yang tidak diizinkan.",
    };
    for (const [code, text] of Object.entries(map))
      if (error.message.includes(code)) throw new Error(text);
    throw new Error(friendly(error.message, "Gagal menyimpan profil"));
  }
  return data;
}
