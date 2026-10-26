import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: db }));
import {
  getSettings,
  notificationsOf,
  privacyOf,
  securityOf,
  updateSettings,
  voiceOf,
  type UserSettingsRow,
} from "../settings";
const row = (patch: Partial<UserSettingsRow> = {}): UserSettingsRow => ({
  user_id: "account-a",
  theme: "dark",
  notifications: {},
  privacy: {},
  security: {},
  voice: {},
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
  ...patch,
});
const select = (value: UserSettingsRow | null) => ({
  select: () => ({
    eq: () => ({
      maybeSingle: async () => ({ data: value, error: null }),
      single: async () => ({ data: value, error: null }),
    }),
  }),
});
beforeEach(() => {
  vi.resetAllMocks();
});
describe("settings storage API", () => {
  it("sends only changed keys to an atomic account-guarded RPC", async () => {
    const saved = row({ notifications: { chat: false, sound: true } });
    db.rpc.mockResolvedValue({ data: saved, error: null });
    expect(await updateSettings("account-a", { notifications: { chat: false } })).toEqual(saved);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("update_my_settings", {
      _expected_user_id: "account-a",
      _patch: { notifications: { chat: false } },
    });
  });
  it("preserves a partial voice custom patch rather than replacing the whole custom object", async () => {
    db.rpc.mockResolvedValue({ data: row(), error: null });
    await updateSettings("account-a", { voice: { custom: { gain: 2 } } });
    expect(db.rpc).toHaveBeenCalledWith("update_my_settings", {
      _expected_user_id: "account-a",
      _patch: { voice: { custom: { gain: 2 } } },
    });
  });
  it("surfaces permission and save failures and rejects unexpected account data", async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(updateSettings("account-a", { theme: "light" })).rejects.toThrow(
      "Anda tidak memiliki akses",
    );
    db.rpc.mockResolvedValueOnce({ data: row({ user_id: "account-b" }), error: null });
    await expect(updateSettings("account-a", { theme: "light" })).rejects.toThrow("Akun berubah");
  });
  it("handles a row created by another device between the initial read and creation", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const otherDevice = row({ theme: "light", notifications: { push: false } });
    db.from
      .mockReturnValueOnce(select(null))
      .mockReturnValueOnce({ upsert })
      .mockReturnValueOnce(select(otherDevice));
    expect(await getSettings("account-a")).toEqual(otherDevice);
    expect(upsert.mock.calls[0]?.[1]).toEqual({ onConflict: "user_id", ignoreDuplicates: true });
  });
  it("does not display missing or corrupt preference values as truthy strings", () => {
    const corrupt = row({
      notifications: { push: "false", sound: null, chat: false },
      privacy: { online: false, readReceipts: "true" },
      security: { appLock: "true" },
      voice: { enabled: "true", intensity: "0.5" },
    });
    expect(notificationsOf(corrupt)).toMatchObject({ push: true, sound: true, chat: false });
    expect(privacyOf(corrupt)).toEqual({ online: false, readReceipts: true });
    expect(securityOf(corrupt)).toEqual({ appLock: false, twoFactor: false });
    expect(voiceOf(corrupt)).toMatchObject({ enabled: false, intensity: 0.7 });
  });
});
