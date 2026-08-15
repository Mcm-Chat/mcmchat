/**
 * Ingatan status izin mikrofon/kamera terakhir (per jenis panggilan).
 *
 * Pemeriksaan izin nyata butuh satu putaran async; tanpa ingatan ini layar
 * panggilan selalu mulai dari "checking" sehingga tombol Jawab sempat mati dan
 * pesannya kosong. Cache dipakai hanya sebagai tebakan awal untuk UI, lalu
 * langsung ditimpa hasil pemeriksaan sebenarnya — jadi ia tidak pernah bisa
 * "mengizinkan" panggilan yang izinnya sudah dicabut di pengaturan sistem.
 */
import type { MediaPermissionKind, MediaPermissionState } from "./media-permission";

const KEY = "mcm.media-permission.v1";
/** Status kadaluarsa setelah 7 hari: izin OS bisa berubah tanpa kabar. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Hanya status pasti yang layak diingat ("checking" bukan hasil). */
const REMEMBERABLE: readonly MediaPermissionState[] = [
  "granted",
  "audio_only",
  "prompt",
  "denied",
  "missing",
  "busy",
  "unsupported",
];

type Entry = { state: MediaPermissionState; at: number };
type Store = Partial<Record<MediaPermissionKind, Entry>>;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // mode privasi / storage diblokir
  }
}

function readStore(): Store {
  const ls = storage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** Status izin terakhir yang diketahui, atau null bila belum ada/kadaluarsa. */
export function readCachedPermission(kind: MediaPermissionKind): MediaPermissionState | null {
  const entry = readStore()[kind];
  if (!entry || typeof entry.at !== "number") return null;
  if (!REMEMBERABLE.includes(entry.state)) return null;
  if (Date.now() - entry.at > MAX_AGE_MS) return null;
  return entry.state;
}

/** Simpan hasil pemeriksaan/permintaan izin terbaru. */
export function writeCachedPermission(
  kind: MediaPermissionKind,
  state: MediaPermissionState,
): void {
  if (!REMEMBERABLE.includes(state)) return;
  const ls = storage();
  if (!ls) return;
  try {
    const next: Store = { ...readStore(), [kind]: { state, at: Date.now() } };
    ls.setItem(KEY, JSON.stringify(next));
  } catch {
    /* penyimpanan penuh/diblokir tidak boleh mengganggu panggilan */
  }
}

/** Bersihkan ingatan izin (dipakai saat keluar akun / uji). */
export function clearCachedPermission(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* abaikan */
  }
}
