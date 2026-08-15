/** Hook status izin media untuk gating tombol "Jawab". */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canAnswer,
  isAudioOnly,
  mediaPermissionCopy,
  queryMediaPermission,
  requestMediaPermission,
  type MediaPermissionCopy,
  type MediaPermissionKind,
  type MediaPermissionState,
} from "./media-permission";

export type UseMediaPermission = {
  state: MediaPermissionState;
  ready: boolean;
  /** Panggilan hanya bisa berjalan tanpa kamera (izin kamera tidak ada). */
  audioOnly: boolean;
  requesting: boolean;
  copy: MediaPermissionCopy;
  /** Minta izin (atau periksa ulang setelah diubah di pengaturan). */
  request: () => Promise<MediaPermissionState>;
  recheck: () => void;
};

export function useMediaPermission(kind: MediaPermissionKind, active = true): UseMediaPermission {
  const [state, setState] = useState<MediaPermissionState>("checking");
  const [requesting, setRequesting] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const recheck = useCallback(() => {
    void queryMediaPermission(kind).then((s) => {
      if (alive.current) setState(s);
    });
  }, [kind]);

  useEffect(() => {
    if (!active) return;
    recheck();
    // Pengguna sering pergi ke Pengaturan sistem lalu kembali: status izin
    // harus dibaca ulang saat layar aktif lagi, bukan menunggu tap manual.
    const onVisible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, recheck]);

  const request = useCallback(async () => {
    setRequesting(true);
    try {
      const next = await requestMediaPermission(kind);
      if (alive.current) setState(next);
      return next;
    } finally {
      if (alive.current) setRequesting(false);
    }
  }, [kind]);

  return {
    state,
    ready: canAnswer(state),
    audioOnly: isAudioOnly(state),
    requesting,
    copy: mediaPermissionCopy(state, kind),
    request,
    recheck,
  };
}
