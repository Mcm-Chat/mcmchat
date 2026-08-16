import { useEffect, useRef, useState } from "react";

/**
 * Deteksi elemen mendekati viewport (sekali saja) untuk lazy-load media chat.
 * rootMargin longgar supaya gambar sudah siap sebelum benar-benar terlihat.
 */
export function useInView<T extends HTMLElement>(rootMargin = "300px 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView } as const;
}
