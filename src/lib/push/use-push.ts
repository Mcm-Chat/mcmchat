import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { attachPushListeners, ensureChannels, isNative, registerNativePush } from "./native";

export type PushState = { native: boolean; registered: boolean; reason?: string };

/**
 * Registrasi push + listener deep link untuk sesi aktif.
 * Di browser (preview) hook ini tidak melakukan apa pun selain melaporkan
 * bahwa perangkat bukan native — UI menampilkan status "belum terhubung".
 */
export function usePushRegistration(userId?: string, prefs?: { sound: boolean; vibrate: boolean }): PushState {
  const navigate = useNavigate();
  const [state, setState] = useState<PushState>({ native: false, registered: false });

  useEffect(() => {
    if (!userId || !isNative()) return;
    let alive = true;
    void registerNativePush(typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) : "Android").then((r) => {
      if (alive) setState({ native: true, registered: r.registered, ...(r.reason ? { reason: r.reason } : {}) });
    });
    const detach = attachPushListeners((route) => {
      void navigate({ to: route });
    });
    return () => {
      alive = false;
      detach();
    };
  }, [userId, navigate]);

  useEffect(() => {
    if (!prefs || !isNative()) return;
    void ensureChannels(prefs.sound, prefs.vibrate);
  }, [prefs]);

  return state;
}
