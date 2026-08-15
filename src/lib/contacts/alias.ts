/**
 * Nama panggilan kontak (alias) milik saya sendiri.
 *
 * Alias tersimpan di `contacts.alias` (satu arah, hanya terlihat oleh saya).
 * Modul ini menyediakan satu sumber kebenaran agar nama yang sudah saya ubah
 * tampil sama di seluruh aplikasi: daftar kontak, chat, dan panggilan.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { saveContact, updateMyContact } from "@/lib/api/contacts";

export const ALIAS_MAX = 40;

export const aliasKey = (userId: string | null | undefined) => [
  "contact-aliases",
  userId ?? "anon",
];

export async function fetchContactAliases(userId: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("contacts")
    .select("contact_id, alias")
    .eq("owner_id", userId);
  const map = new Map<string, string>();
  for (const row of data ?? []) if (row.alias) map.set(row.contact_id, row.alias);
  return map;
}

/** Bersihkan input nama: tanpa karakter kontrol, dipangkas, maksimal 40 karakter. */
export function normalizeAlias(input: string): string {
  return (
    input
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, ALIAS_MAX)
  );
}

/**
 * Simpan nama panggilan. Bila kontak belum ada di buku kontak saya, kartunya
 * disimpan lebih dulu agar penggantian nama tetap berhasil dari mana saja
 * (chat lama, riwayat panggilan, hasil pindai).
 */
export async function setContactAlias(
  userId: string,
  contactId: string,
  rawName: string,
): Promise<string | null> {
  const alias = normalizeAlias(rawName);
  try {
    await updateMyContact(contactId, { alias });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!message.includes("contact_not_found") && !message.includes("tidak ditemukan")) throw err;
    await saveContact(userId, contactId, "manual", alias || null);
  }
  return alias || null;
}

/** Peta alias saya + penyelesai nama tampilan dengan fallback nama asli. */
export function useContactAliases() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const query = useQuery({
    queryKey: aliasKey(userId),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: () => fetchContactAliases(userId!),
  });
  const map = query.data;
  const nameOf = useCallback(
    (contactId: string | null | undefined, fallback: string) =>
      (contactId ? map?.get(contactId) : null) || fallback,
    [map],
  );
  return { userId, aliases: map, nameOf };
}

/** Segarkan semua tampilan nama setelah alias berubah. */
export function useRefreshAliases() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: aliasKey(userId) });
    void qc.invalidateQueries({ queryKey: ["contacts"] });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
  }, [qc, userId]);
}
