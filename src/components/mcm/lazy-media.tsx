import { useState, type ReactNode } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInView } from "@/lib/perf/use-in-view";
import { useSignedUrlState } from "@/lib/api/use-signed-url";

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
 * Fallback saat media gagal dimuat: ikon, teks alasan, dan tombol coba lagi.
 * Dipakai foto, dokumen, voice note, dan pratinjau tautan.
 */
export function MediaError({
  label = "Media gagal dimuat",
  onRetry,
  className,
  icon,
  compact,
}: {
  label?: string;
  onRetry?: () => void;
  className?: string;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-center",
        compact && "flex-row gap-2 p-2 text-left",
        className,
      )}
    >
      <span className="text-destructive" aria-hidden>
        {icon ?? <ImageOff className="size-5" />}
      </span>
      <span className={cn("text-xs text-muted-foreground", compact && "flex-1 truncate")}>
        {label}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Coba muat ulang: ${label}`}
          className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="size-3.5" aria-hidden />
          Coba lagi
        </button>
      )}
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
  const { url, status, reload } = useSignedUrlState(bucket, path, inView);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const broken = status === "error" || failed;
  const retry = () => {
    setFailed(false);
    setLoaded(false);
    reload();
  };
  return (
    <div ref={ref} className={cn("relative overflow-hidden", frameClassName ?? className)}>
      {broken && (
        <MediaError
          label="Foto gagal dimuat"
          onRetry={retry}
          className="absolute inset-0 size-full rounded-[inherit]"
        />
      )}
      {!loaded && !broken && (
        <MediaSkeleton className={cn("absolute inset-0 size-full rounded-[inherit]")}>
          {fallback}
        </MediaSkeleton>
      )}
      {url && !broken && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
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

/**
 * Gambar dari URL publik (mis. pratinjau tautan) dengan bingkai berukuran tetap
 * dan skeleton, agar tinggi bubble tidak berubah saat gambar selesai dimuat.
 */
export function RemoteImage({
  src,
  alt,
  className,
  frameClassName,
  fallback,
}: {
  src?: string | null | undefined;
  alt: string;
  className?: string;
  frameClassName?: string;
  fallback?: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className={cn("relative overflow-hidden", frameClassName)}>
      {failed && (
        <MediaError
          label="Gambar gagal dimuat"
          onRetry={() => {
            setFailed(false);
            setLoaded(false);
            setAttempt((n) => n + 1);
          }}
          className="absolute inset-0 size-full rounded-[inherit]"
        />
      )}
      {!loaded && !failed && (
        <MediaSkeleton className="absolute inset-0 size-full rounded-[inherit]">
          {fallback}
        </MediaSkeleton>
      )}
      {src && !failed && (
        <img
          key={attempt}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
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
