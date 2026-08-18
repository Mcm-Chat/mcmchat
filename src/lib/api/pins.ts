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

/**
 * Setelah pendaftaran, baris profil (dan PIN-nya) dibuat oleh trigger server.
 * Kadang RPC pertama berjalan sepersekian detik sebelum baris itu ada, jadi
 * kartu profil bisa tampil kosong. Ulangi beberapa kali sampai PIN terbit.
 */
export async function myPinWithRetry(attempts = 6, delayMs = 600): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const pin = await myPin().catch(() => "");
    if (pin) return pin;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return "";
}

export async function pinsFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.rpc("pins_for_me", { _ids: unique });
  return new Map(((data ?? []) as { id: string; pin: string }[]).map((r) => [r.id, r.pin]));
}
