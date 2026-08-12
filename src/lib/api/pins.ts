import { supabase } from "@/integrations/supabase/client";

/**
 * PIN bukan lagi kolom yang bebas dibaca semua pengguna login.
 *
 * Kolom `profiles.pin` dicabut dari grant tabel, sehingga satu-satunya jalan
 * membacanya adalah dua fungsi berikut:
 * - `my_pin()`      → PIN milik sendiri.
 * - `pins_for_me()` → PIN kontak yang memang sudah tersimpan.
 *
 * Pencarian orang baru tetap lewat `find_profile_by_pin` (PIN → profil), yang
 * sudah dibatasi rate limit; yang ditutup adalah arah sebaliknya
 * (menyapu seluruh tabel profil untuk memanen PIN).
 */
export async function myPin(): Promise<string> {
  const { data } = await supabase.rpc("my_pin");
  return data ?? "";
}

export async function pinsFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.rpc("pins_for_me", { _ids: unique });
  return new Map(((data ?? []) as { id: string; pin: string }[]).map((r) => [r.id, r.pin]));
}