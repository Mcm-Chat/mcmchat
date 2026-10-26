import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Json, Tables } from "@/integrations/supabase/types";
import {
  DEFAULT_VOICE_PREFS,
  normalizePrefs,
  type VoicePrefs,
  type VoiceParams,
} from "@/lib/voice/presets";

export type UserSettingsRow = Tables<"user_settings">;

export type NotificationsPrefs = {
  /** Master switch push perangkat. */
  push: boolean;
  /** Pratinjau isi pesan di layar kunci. */
  preview: boolean;
  sound: boolean;
  vibrate: boolean;
  /** Kategori: dipakai juga oleh fan-out push di server. */
  chat: boolean;
  group: boolean;
  calls: boolean;
  tasks: boolean;
  sales: boolean;
  ledger: boolean;
  badge: boolean;
};
export type PrivacyPrefs = { online: boolean; readReceipts: boolean };
export type SecurityPrefs = { appLock: boolean; twoFactor: boolean };

const DEFAULT_NOTIFICATIONS: NotificationsPrefs = {
  push: true,
  preview: true,
  sound: true,
  vibrate: true,
  chat: true,
  group: true,
  calls: true,
  tasks: true,
  sales: true,
  ledger: true,
  badge: true,
};
const DEFAULT_PRIVACY: PrivacyPrefs = { online: true, readReceipts: true };
const DEFAULT_SECURITY: SecurityPrefs = { appLock: false, twoFactor: false };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Accept only actual booleans; use defaults for missing or malformed legacy keys. */
function booleanPrefs<T extends Record<string, boolean>>(defaults: T, value: unknown): T {
  const input = asRecord(value);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      typeof input[key] === "boolean" ? input[key] : fallback,
    ]),
  ) as T;
}

export function notificationsOf(row: UserSettingsRow | null): NotificationsPrefs {
  return booleanPrefs(DEFAULT_NOTIFICATIONS, row?.notifications);
}
export function privacyOf(row: UserSettingsRow | null): PrivacyPrefs {
  return booleanPrefs(DEFAULT_PRIVACY, row?.privacy);
}
export function securityOf(row: UserSettingsRow | null): SecurityPrefs {
  return booleanPrefs(DEFAULT_SECURITY, row?.security);
}
/** Preferensi Voice Privacy. Hanya setelan (angka), tidak pernah sampel suara. */
export function voiceOf(row: UserSettingsRow | null): VoicePrefs {
  const input = asRecord(row?.voice);
  return normalizePrefs({
    ...input,
    enabled: input["enabled"] === true,
    intensity:
      typeof input["intensity"] === "number" ? input["intensity"] : DEFAULT_VOICE_PREFS.intensity,
    custom: asRecord(input["custom"]) as VoicePrefs["custom"],
  });
}

/** Ambil pengaturan pengguna, membuat baris default jika belum ada. */
export async function getSettings(userId: string): Promise<UserSettingsRow> {
  const existing = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.error) throw new Error(friendly(existing.error.message, "Gagal memuat pengaturan"));
  if (existing.data) return existing.data;
  // A second device/bootstrap may create this row between our SELECT and INSERT.
  // Ignore that conflict and read the winning row; never overwrite its preferences.
  const created = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      theme: "dark",
      notifications: DEFAULT_NOTIFICATIONS as unknown as Json,
      privacy: DEFAULT_PRIVACY as unknown as Json,
      security: DEFAULT_SECURITY as unknown as Json,
      voice: DEFAULT_VOICE_PREFS as unknown as Json,
    },
    { onConflict: "user_id", ignoreDuplicates: true },
  );
  if (created.error) throw new Error(friendly(created.error.message, "Gagal membuat pengaturan"));
  return unwrap(
    await supabase.from("user_settings").select("*").eq("user_id", userId).single(),
    "Gagal memuat pengaturan",
  );
}

export type SettingsPatch = {
  theme?: string;
  notifications?: Partial<NotificationsPrefs>;
  privacy?: Partial<PrivacyPrefs>;
  security?: Partial<SecurityPrefs>;
  voice?: Omit<Partial<VoicePrefs>, "custom"> & { custom?: Partial<VoiceParams> };
};

/** Atomic, account-checked patch. No client read/merge/write that loses other devices' edits. */
export async function updateSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettingsRow> {
  if (!userId) throw new Error("Masuk kembali untuk menyimpan pengaturan.");
  const row = unwrap(
    await supabase.rpc("update_my_settings", {
      _expected_user_id: userId,
      _patch: patch as Json,
    }),
    "Gagal menyimpan pengaturan. Periksa koneksi atau hubungi admin.",
  );
  if (row.user_id !== userId) throw new Error("Akun berubah. Muat ulang pengaturan.");
  return row;
}

/**
 * Tabel `devices` tertutup penuh untuk klien (tanpa grant, tanpa policy).
 * Semua akses perangkat lewat RPC yang tidak pernah mengembalikan
 * `push_token`, `action_token_hash`, atau `action_token_prefix`.
 */
export type DeviceRow = {
  id: string;
  installation_id: string | null;
  name: string;
  platform: string;
  app_version: string;
  push_enabled: boolean;
  revoked: boolean;
  last_active_at: string;
  created_at: string;
};

export async function listDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase.rpc("my_push_devices");
  if (error) throw new Error(friendly(error.message, "Gagal memuat daftar perangkat"));
  return (data ?? []) as DeviceRow[];
}

export async function removeDevice(deviceId: string) {
  const { error } = await supabase.rpc("revoke_my_push_device", { _device: deviceId });
  if (error) throw new Error(friendly(error.message, "Gagal mengeluarkan perangkat"));
}

export async function removeAllDevices(): Promise<number> {
  const { data, error } = await supabase.rpc("revoke_my_push_devices");
  if (error) throw new Error(friendly(error.message, "Gagal mengeluarkan perangkat"));
  return Number(data ?? 0);
}

/** Cabut hanya instalasi tertentu (perangkat yang sedang dipakai). */
export async function removeInstallation(installationId: string): Promise<number> {
  const { data, error } = await supabase.rpc("revoke_my_push_installation", {
    _installation_id: installationId,
  });
  if (error) throw new Error(friendly(error.message, "Gagal mengeluarkan perangkat"));
  return Number(data ?? 0);
}
