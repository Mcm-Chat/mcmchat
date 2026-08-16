import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInView } from "@/lib/perf/use-in-view";
import { useSignedUrl } from "@/lib/api/use-signed-url";

/** Skeleton berdenyut dengan ukuran tetap agar tinggi baris tidak berubah saat gulir. */
export function MediaSkeleton({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex animate-pulse items-center justify-center rounded-xl bg-black/15",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Gambar storage privat yang hanya meminta signed URL saat mendekati viewport,
 * lalu memudar masuk setelah dekode selesai. Placeholder memakai ukuran final.
 */
export function LazyStorageImage({
  bucket,
  path,
  alt,
  className,
  frameClassName,
  fallback,
}: {
  bucket: string;
  path?: string | null;
  alt: string;
  className?: string;
  frameClassName?: string;
  fallback?: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const url = useSignedUrl(bucket, path, inView);
  const [loaded, setLoaded] = useState(false);
  return (
    <div ref={ref} className={cn("relative overflow-hidden", frameClassName ?? className)}>
      {!loaded && (
        <MediaSkeleton className={cn("absolute inset-0 size-full rounded-[inherit]")}>
          {fallback}
        </MediaSkeleton>
      )}
      {url && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={cn(
            "size-full transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
            className,
          )}
        />
      )}
    </div>
  );
}
