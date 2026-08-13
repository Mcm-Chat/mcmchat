/**
 * Aturan murni untuk audiens foto profil.
 *
 * Dipisah dari komponen agar dapat diuji tanpa DOM: pemetaan mode, ringkasan
 * teks, dan syarat simpan berada di satu tempat.
 */
import type { AvatarPrivacy, AudienceMode } from "@/lib/api/avatar";

/** Mode audiens yang dipakai `avatar_audience` untuk sebuah pilihan privasi. */
export function audienceModeFor(privacy: AvatarPrivacy): AudienceMode | null {
  if (privacy === "contacts_except") return "except";
  if (privacy === "only_share") return "only";
  return null;
}

/** Pilihan privasi yang membutuhkan pemilih kontak. */
export function needsAudience(privacy: AvatarPrivacy): boolean {
  return audienceModeFor(privacy) !== null;
}

/**
 * `only_share` tanpa penerima berarti tidak seorang pun dapat melihat foto.
 * Simpan tetap boleh, tetapi hanya setelah pengguna menegaskan.
 */
export function requiresEmptyConfirm(privacy: AvatarPrivacy, selectedCount: number): boolean {
  return privacy === "only_share" && selectedCount === 0;
}

/** Ringkasan yang ditampilkan di bawah opsi privasi. */
export function audienceSummary(privacy: AvatarPrivacy, selectedCount: number): string {
  if (privacy === "contacts_except") {
    return selectedCount === 0
      ? "0 dikecualikan — sama dengan semua kontak"
      : `${selectedCount} dikecualikan`;
  }
  if (privacy === "only_share") {
    return selectedCount === 0
      ? "Belum ada penerima — sama dengan tidak seorang pun"
      : `${selectedCount} dipilih`;
  }
  return "";
}

/** Pencarian kontak: cocokkan nama atau PIN, tidak peka huruf besar/kecil. */
export function filterAudienceCandidates<T extends { display_name: string; pin: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.display_name.toLowerCase().includes(q) || i.pin.toLowerCase().includes(q),
  );
}

/** Toggle seleksi yang stabil (tanpa duplikat, urutan dipertahankan). */
export function toggleSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}
