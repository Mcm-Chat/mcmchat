import { useEffect, useState } from "react";
import { signedUrl } from "./storage";

/**
 * Ambil URL bertanda tangan untuk objek storage privat (foto chat/produk/avatar).
 * `enabled=false` menunda permintaan (dipakai lazy-load media chat saat di luar viewport).
 */
export function useSignedUrl(bucket: string, path?: string | null, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!path || !enabled) {
      setUrl(null);
      return;
    }
    void signedUrl(bucket, path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [bucket, path, enabled]);
  return url;
}
