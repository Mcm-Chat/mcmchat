import { useCallback, useEffect, useState } from "react";
import { signedUrl } from "./storage";

export type SignedUrlStatus = "idle" | "loading" | "ready" | "error";

/**
 * Versi lengkap: selain URL, memberi status muat dan fungsi `reload` supaya UI
 * bisa menampilkan fallback "gagal dimuat" dengan tombol coba lagi.
 */
export function useSignedUrlState(bucket: string, path?: string | null, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<SignedUrlStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    if (!path || !enabled) {
      setUrl(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    void signedUrl(bucket, path)
      .then((u) => {
        if (!active) return;
        setUrl(u);
        setStatus(u ? "ready" : "error");
      })
      .catch(() => {
        if (!active) return;
        setUrl(null);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [bucket, path, enabled, attempt]);

  return { url, status, reload };
}

/**
 * Ambil URL bertanda tangan untuk objek storage privat (foto chat/produk/avatar).
 * `enabled=false` menunda permintaan (dipakai lazy-load media chat saat di luar viewport).
 */
export function useSignedUrl(bucket: string, path?: string | null, enabled = true) {
  return useSignedUrlState(bucket, path, enabled).url;
}
