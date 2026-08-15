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
import { readCachedPermission, writeCachedPermission } from "./permission-cache";

export type UseMediaPermission = {
  state: MediaPermissionState;
  ready: boolean;
  /** Panggilan hanya bisa berjalan tanpa kamera (izin kamera tidak ada). */
  audioOnly: boolean;
  requesting: boolean;
  copy: MediaPermissionCopy;
  /** Status awal berasal dari ingatan izin terakhir, belum diverifikasi ulang. */
  fromCache: boolean;
  /** Minta izin (atau periksa ulang setelah diubah di pengaturan). */
  request: () => Promise<MediaPermissionState>;
  recheck: () => void;
};

export function useMediaPermission(kind: MediaPermissionKind, active = true): UseMediaPermission {
  // Mulai dari izin terakhir yang diingat supaya tombol Jawab dan pesannya
  // langsung benar saat layar dibuka, tanpa kedip "memeriksa izin…".
  const [state, setState] = useState<MediaPermissionState>(
    () => readCachedPermission(kind) ?? "checking",
  );
  const [verified, setVerified] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Ganti jenis panggilan = ingatan izin lain.
  useEffect(() => {
    setVerified(false);
    setState(readCachedPermission(kind) ?? "checking");
  }, [kind]);

  const apply = useCallback(
    (next: MediaPermissionState) => {
      writeCachedPermission(kind, next);
      if (!alive.current) return;
      setState(next);
      setVerified(true);
    },
    [kind],
  );

  const recheck = useCallback(() => {
    void queryMediaPermission(kind).then(apply);
  }, [apply, kind]);

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
      apply(next);
      return next;
    } finally {
      if (alive.current) setRequesting(false);
    }
  }, [apply, kind]);

  return {
    state,
    ready: canAnswer(state),
    audioOnly: isAudioOnly(state),
    requesting,
    copy: mediaPermissionCopy(state, kind),
    fromCache: !verified && state !== "checking",
    request,
    recheck,
  };
}
