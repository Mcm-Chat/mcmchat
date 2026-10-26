import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSettings,
  updateSettings,
  type SettingsPatch,
  type UserSettingsRow,
} from "@/lib/api/settings";

const SAVED_EVENT = "tokolink:settings-saved";
const inflight = new Map<string, Promise<UserSettingsRow>>();
const writes = new Map<string, Promise<UserSettingsRow>>();
type SettingsEvent = { userId: string; saving: boolean; settings?: UserSettingsRow };

function publish(detail: SettingsEvent) {
  window.dispatchEvent(new CustomEvent<SettingsEvent>(SAVED_EVENT, { detail }));
}

/** Serialize local UI writes across hooks; the DB handles independent devices. */
function writeSettings(userId: string, patch: SettingsPatch) {
  inflight.delete(userId);
  const previous = writes.get(userId);
  const request = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
    updateSettings(userId, patch),
  );
  writes.set(userId, request);
  publish({ userId, saving: true });
  return request
    .then((settings) => {
      publish({ userId, settings, saving: writes.get(userId) !== request });
      return settings;
    })
    .finally(() => {
      if (writes.get(userId) === request) {
        writes.delete(userId);
        publish({ userId, saving: false });
      }
    });
}

/** Coalesce the app shell and visible settings pages into one request per account. */
function readSettings(userId: string) {
  let request = inflight.get(userId);
  if (!request) {
    const write = writes.get(userId);
    request = (write ? write.catch(() => undefined) : Promise.resolve())
      .then(() => getSettings(userId))
      .finally(() => {
        if (inflight.get(userId) === request) inflight.delete(userId);
      });
    inflight.set(userId, request);
  }
  return request;
}

/** Account-scoped settings with explicit failures and eventual cross-device refresh. */
export function useUserSettings(userId: string | null | undefined) {
  const account = userId ?? null;
  const active = useRef(account);
  active.current = account;
  const version = useRef(0);
  const mounted = useRef(false);
  const [state, setState] = useState<{
    account: string | null;
    settings: UserSettingsRow | null;
    error: string | null;
    loading: boolean;
    saving: boolean;
  }>({ account, settings: null, error: null, loading: Boolean(account), saving: false });

  const refresh = useCallback(async () => {
    if (!account) return;
    const token = ++version.current;
    try {
      const settings = await readSettings(account);
      if (!mounted.current || active.current !== account || token !== version.current) return;
      setState((s) => ({ ...s, account, settings, error: null, loading: false }));
    } catch (error) {
      if (!mounted.current || active.current !== account || token !== version.current) return;
      setState((s) => ({
        ...s,
        account,
        error: error instanceof Error ? error.message : "Gagal memuat pengaturan",
        loading: false,
      }));
    }
  }, [account]);

  useEffect(() => {
    mounted.current = true;
    ++version.current;
    setState({ account, settings: null, error: null, loading: Boolean(account), saving: false });
    void refresh();
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<SettingsEvent>).detail;
      if (!account || detail?.userId !== account || active.current !== account) return;
      // A failed write only ends the busy state. A consumer mounted while it
      // was pending must still accept its subsequent fresh settings read.
      if (detail.saving || detail.settings) ++version.current;
      setState((s) => ({
        ...s,
        account,
        saving: detail.saving,
        ...(detail.settings ? { settings: detail.settings, loading: false, error: null } : {}),
      }));
    };
    const onResume = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) void refresh();
    };
    window.addEventListener(SAVED_EVENT, onSaved);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    document.addEventListener("visibilitychange", onResume);
    // Works even when user_settings has not been added to the Realtime publication.
    const interval = window.setInterval(onResume, 30_000);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      window.removeEventListener(SAVED_EVENT, onSaved);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("online", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [account, refresh]);

  const patch = useCallback(
    async (value: SettingsPatch) => {
      if (!account || active.current !== account)
        throw new Error("Masuk kembali untuk menyimpan pengaturan.");
      ++version.current; // A refresh begun before this write must not overwrite the saved row.
      setState((s) => ({ ...s, saving: true }));
      try {
        const row = await writeSettings(account, value);
        if (!mounted.current || active.current !== account)
          throw new Error("Akun berubah. Muat ulang pengaturan.");
        return row;
      } finally {
        if (mounted.current && active.current === account)
          setState((s) => ({ ...s, saving: writes.has(account) }));
      }
    },
    [account],
  );

  // Do not expose the preceding account's row during the render before effect cleanup.
  const current =
    state.account === account
      ? state
      : { settings: null, error: null, loading: Boolean(account), saving: false };
  return {
    settings: current.settings,
    error: current.error,
    loading: current.loading,
    saving: current.saving,
    refresh,
    patch,
  };
}
