import { useEffect, useState } from "react";
import { signedUrl } from "./storage";

/** Ambil URL bertanda tangan untuk objek storage privat (foto chat/produk/avatar). */
export function useSignedUrl(bucket: string, path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void signedUrl(bucket, path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [bucket, path]);
  return url;
}
