import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Json, Tables, TablesUpdate } from "@/integrations/supabase/types";
import { DEFAULT_VOICE_PREFS, normalizePrefs, type VoicePrefs } from "@/lib/voice/presets";

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

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function notificationsOf(row: UserSettingsRow | null): NotificationsPrefs {
  return { ...DEFAULT_NOTIFICATIONS, ...asRecord(row?.notifications) } as NotificationsPrefs;
}
export function privacyOf(row: UserSettingsRow | null): PrivacyPrefs {
  return { ...DEFAULT_PRIVACY, ...asRecord(row?.privacy) } as PrivacyPrefs;
}
export function securityOf(row: UserSettingsRow | null): SecurityPrefs {
  return { ...DEFAULT_SECURITY, ...asRecord(row?.security) } as SecurityPrefs;
}
/** Preferensi Voice Privacy. Hanya setelan (angka), tidak pernah sampel suara. */
export function voiceOf(row: UserSettingsRow | null): VoicePrefs {
  return normalizePrefs(asRecord(row?.voice) as Partial<VoicePrefs>);
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
  return unwrap(
    await supabase
      .from("user_settings")
      .insert({
        user_id: userId,
        theme: "dark",
        notifications: DEFAULT_NOTIFICATIONS as unknown as Json,
        privacy: DEFAULT_PRIVACY as unknown as Json,
        security: DEFAULT_SECURITY as unknown as Json,
        voice: DEFAULT_VOICE_PREFS as unknown as Json,
      })
      .select("*")
      .single(),
    "Gagal membuat pengaturan",
  );
}

export type SettingsPatch = {
  theme?: string;
  notifications?: Partial<NotificationsPrefs>;
  privacy?: Partial<PrivacyPrefs>;
  security?: Partial<SecurityPrefs>;
  voice?: Partial<VoicePrefs>;
};

/** Gabungkan patch jsonb parsial di sisi klien lalu simpan seluruh objek. */
export async function updateSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettingsRow> {
  const current = await getSettings(userId);
  const update: TablesUpdate<"user_settings"> = {};
  if (patch.theme) update.theme = patch.theme;
  if (patch.notifications)
    update.notifications = {
      ...notificationsOf(current),
      ...patch.notifications,
    } as unknown as Json;
  if (patch.privacy)
    update.privacy = { ...privacyOf(current), ...patch.privacy } as unknown as Json;
  if (patch.voice)
    update.voice = normalizePrefs({ ...voiceOf(current), ...patch.voice }) as unknown as Json;
  if (patch.security)
    update.security = { ...securityOf(current), ...patch.security } as unknown as Json;
  return unwrap(
    await supabase.from("user_settings").update(update).eq("user_id", userId).select("*").single(),
    "Gagal menyimpan pengaturan",
  );
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
