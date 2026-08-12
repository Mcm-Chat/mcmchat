import { supabase } from "@/integrations/supabase/client";
import { friendly, unwrap } from "./db";
import type { Json, Tables, TablesUpdate } from "@/integrations/supabase/types";

export type UserSettingsRow = Tables<"user_settings">;

export type NotificationsPrefs = { chat: boolean; calls: boolean; push: boolean };
export type PrivacyPrefs = { online: boolean; readReceipts: boolean };
export type SecurityPrefs = { appLock: boolean; twoFactor: boolean };

const DEFAULT_NOTIFICATIONS: NotificationsPrefs = { chat: true, calls: true, push: false };
const DEFAULT_PRIVACY: PrivacyPrefs = { online: true, readReceipts: true };
const DEFAULT_SECURITY: SecurityPrefs = { appLock: false, twoFactor: false };

function asRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

/** Ambil pengaturan pengguna, membuat baris default jika belum ada. */
export async function getSettings(userId: string): Promise<UserSettingsRow> {
  const existing = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
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
};

/** Gabungkan patch jsonb parsial di sisi klien lalu simpan seluruh objek. */
export async function updateSettings(userId: string, patch: SettingsPatch): Promise<UserSettingsRow> {
  const current = await getSettings(userId);
  const update: TablesUpdate<"user_settings"> = {};
  if (patch.theme) update.theme = patch.theme;
  if (patch.notifications) update.notifications = { ...notificationsOf(current), ...patch.notifications } as unknown as Json;
  if (patch.privacy) update.privacy = { ...privacyOf(current), ...patch.privacy } as unknown as Json;
  if (patch.security) update.security = { ...securityOf(current), ...patch.security } as unknown as Json;
  return unwrap(
    await supabase.from("user_settings").update(update).eq("user_id", userId).select("*").single(),
    "Gagal menyimpan pengaturan",
  );
}

export type DeviceRow = Tables<"devices">;

export async function listDevices(userId: string): Promise<DeviceRow[]> {
  return unwrap(
    await supabase.from("devices").select("*").eq("user_id", userId).order("last_active_at", { ascending: false }),
    "Gagal memuat daftar perangkat",
  );
}

export async function removeDevice(deviceId: string) {
  const { error } = await supabase.from("devices").delete().eq("id", deviceId);
  if (error) throw new Error(friendly(error.message, "Gagal mengeluarkan perangkat"));
}
