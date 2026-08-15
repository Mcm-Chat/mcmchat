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
  /**
   * Izin yang sudah terbukti nyata pada sesi ini (hasil getUserMedia sukses).
   * Rotasi layar / pindah tab memicu pemeriksaan ulang, dan di banyak WebView
   * Permissions API tidak ada sehingga hasilnya "prompt"/"unsupported". Tanpa
   * penjaga ini kontrol mikrofon & kamera mendadak mati di tengah panggilan.
   */
  const proven = useRef<MediaPermissionState | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Ganti jenis panggilan = ingatan izin lain.
  useEffect(() => {
    setVerified(false);
    proven.current = null;
    setState(readCachedPermission(kind) ?? "checking");
  }, [kind]);

  const apply = useCallback(
    (next: MediaPermissionState) => {
      // Jangan turunkan izin yang sudah terbukti hanya karena pemeriksaan pasif
      // tidak bisa memastikannya (Permissions API absen di WebView Android).
      const weak = next === "checking" || next === "prompt" || next === "unsupported";
      const effective = weak && proven.current ? proven.current : next;
      if (!weak) proven.current = null;
      writeCachedPermission(kind, effective);
      if (!alive.current) return;
      setState(effective);
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
    // Rotasi layar me-remount sebagian UI: periksa ulang agar status tetap
    // sinkron, tapi hasil lemah tidak boleh mematikan kontrol (lihat `apply`).
    window.addEventListener("orientationchange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("orientationchange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [active, recheck]);

  const request = useCallback(async () => {
    setRequesting(true);
    try {
      const next = await requestMediaPermission(kind);
      if (next === "granted" || next === "audio_only") proven.current = next;
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
