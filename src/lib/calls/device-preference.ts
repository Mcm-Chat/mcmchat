/**
 * Ingatan pilihan perangkat panggilan (mikrofon & kamera).
 *
 * Pengguna MCM biasanya memakai headset atau kamera yang sama setiap hari.
 * Tanpa ingatan ini, setiap kali layar panggilan dibuka sistem kembali ke
 * perangkat bawaan sehingga lawan bicara mendengar mikrofon yang salah.
 * Pilihan disimpan sebagai *preferensi*, bukan paksaan: bila perangkatnya
 * sedang tidak tercolok, panggilan tetap berjalan dengan perangkat bawaan.
 */

export type CallDeviceRole = "mic" | "camera";

const KEY = "mcm.call-device.v1";
/** Perangkat yang tak dipakai sebulan biasanya sudah tidak relevan. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type Entry = { deviceId: string; label?: string; at: number };
type Store = Partial<Record<CallDeviceRole, Entry>>;

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

/** deviceId terakhir yang dipilih, atau null bila belum ada/kadaluarsa. */
export function readPreferredDevice(role: CallDeviceRole): string | null {
  const entry = readStore()[role];
  if (!entry || typeof entry.deviceId !== "string" || typeof entry.at !== "number") return null;
  if (!entry.deviceId) return null;
  if (Date.now() - entry.at > MAX_AGE_MS) return null;
  return entry.deviceId;
}

export function writePreferredDevice(role: CallDeviceRole, deviceId: string | null): void {
  if (!deviceId) return;
  const ls = storage();
  if (!ls) return;
  try {
    const next: Store = { ...readStore(), [role]: { deviceId, at: Date.now() } };
    ls.setItem(KEY, JSON.stringify(next));
  } catch {
    /* penyimpanan penuh tidak boleh mengganggu panggilan */
  }
}

export function clearPreferredDevices(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* abaikan */
  }
}

/**
 * Pilihan tersimpan hanya dipakai bila perangkatnya benar-benar ada sekarang;
 * deviceId dari sesi lama bisa hilang setelah headset dicabut.
 */
export function resolvePreferredDevice(
  role: CallDeviceRole,
  available: ReadonlyArray<{ deviceId: string }>,
): string | null {
  const want = readPreferredDevice(role);
  if (!want) return null;
  return available.some((d) => d.deviceId === want) ? want : null;
}
