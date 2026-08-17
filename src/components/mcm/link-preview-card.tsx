import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2 } from "lucide-react";
import { fetchLinkPreview } from "@/lib/api/link-preview.functions";
import { cn } from "@/lib/utils";
import { useLinkOpener } from "@/lib/mcm/use-link-opener";
import { MediaSkeleton, RemoteImage } from "@/components/mcm/lazy-media";
import { useInView } from "@/lib/perf/use-in-view";

const CARD_CLS = "mt-1.5 block w-56 max-w-[68vw] overflow-hidden rounded-xl border text-left";

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** URL pertama yang layak dibuatkan kartu pratinjau dari sebuah teks pesan. */
export function firstUrlOf(text?: string | null): string | null {
  if (!text) return null;
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(text);
  if (!m) return null;
  const token = m[0].replace(/[.,!?)：:;]+$/, "");
  const href = /^https?:\/\//i.test(token) ? token : `https://${token}`;
  try {
    const u = new URL(href);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Kartu pratinjau link (judul, gambar, deskripsi) di dalam bubble chat. */
export function LinkPreviewCard({ url, onBubble }: { url: string; onBubble?: boolean }) {
  const unfurl = useServerFn(fetchLinkPreview);
  const openLink = useLinkOpener();
  // Unfurl hanya dijalankan saat kartu mendekati viewport agar daftar pesan
  // panjang tidak menembak puluhan permintaan pratinjau sekaligus.
  const { ref, inView } = useInView<HTMLDivElement>();
  const { data, isPending } = useQuery({
    queryKey: ["link-preview", url],
    queryFn: () => unfurl({ data: { url } }),
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24,
    retry: false,
    enabled: inView,
  });
  if (!inView || isPending) {
    return (
      <div
        ref={ref}
        aria-hidden
        className={cn(
          CARD_CLS,
          onBubble ? "border-current/25 bg-black/10" : "border-border/70 bg-background/70",
        )}
      >
        <MediaSkeleton className="h-28 w-full rounded-none" />
        <div className="space-y-1.5 px-2.5 py-2">
          <MediaSkeleton className="h-2.5 w-20 rounded" />
          <MediaSkeleton className="h-3 w-full rounded" />
          <MediaSkeleton className="h-3 w-3/4 rounded" />
        </div>
      </div>
    );
  }
  if (!data) return <div ref={ref} className="hidden" />;
  const host = (() => {
    try {
      return new URL(data.url).hostname.replace(/^www\./, "");
    } catch {
      return data.siteName ?? "";
    }
  })();

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => {
        e.stopPropagation();
        openLink(data.url, e);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`Buka tautan ${data.title ? `${data.title} — ` : ""}${host}`}
      className={cn(
        CARD_CLS,
        "transition-opacity active:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        onBubble ? "border-current/25 bg-black/10" : "border-border/70 bg-background/70",
      )}
    >
      {data.image && (
        <RemoteImage
          src={data.image}
          alt={data.title ?? "Pratinjau link"}
          frameClassName="h-28 w-full sm:h-32"
          className="object-cover"
        />
      )}
      <div className="space-y-0.5 px-2.5 py-2">
        <span
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase",
            onBubble ? "opacity-80" : "text-muted-foreground",
          )}
        >
          <Link2 className="size-3 shrink-0" />
          <span className="truncate">{data.siteName || host}</span>
        </span>
        {data.title && (
          <p className="line-clamp-2 text-[12.5px] leading-snug font-semibold">{data.title}</p>
        )}
        {data.description && (
          <p
            className={cn(
              "line-clamp-2 text-[11.5px] leading-snug",
              onBubble ? "opacity-85" : "text-muted-foreground",
            )}
          >
            {data.description}
          </p>
        )}
      </div>
    </a>
  );
}
