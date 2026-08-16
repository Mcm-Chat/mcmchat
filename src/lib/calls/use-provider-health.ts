/**
 * Status server panggilan (LiveKit) yang dipakai bersama oleh chip status dan
 * label fase. Satu sumber kebenaran supaya layar tidak pernah menampilkan
 * "Panggilan berjalan" saat servernya sebenarnya belum terhubung.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCallConfig } from "./calls.functions";

export type ProviderHealth = "checking" | "online" | "offline";

export const PROVIDER_REFRESH_MS = 60_000;

export type ProviderHealthResult = {
  health: ProviderHealth;
  code: string | null;
  checkedAt: Date | null;
  busy: boolean;
  refresh: () => void;
};

export function useProviderHealth(): ProviderHealthResult {
  const loadConfig = useServerFn(getCallConfig);
  const [health, setHealth] = useState<ProviderHealth>("checking");
  const [code, setCode] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const c = await loadConfig();
      if (!alive.current) return;
      setHealth(c.configured ? "online" : "offline");
      setCode(c.configured ? null : (c.code ?? null));
    } catch {
      if (!alive.current) return;
      setHealth("offline");
      setCode("network");
    } finally {
      if (alive.current) {
        setCheckedAt(new Date());
        setBusy(false);
      }
    }
  }, [loadConfig]);

  useEffect(() => {
    alive.current = true;
    void run();
    const t = setInterval(() => void run(), PROVIDER_REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [run]);

  return { health, code, checkedAt, busy, refresh: () => void run() };
}
