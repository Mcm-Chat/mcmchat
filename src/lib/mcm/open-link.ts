import { Capacitor } from "@capacitor/core";
import { SITE_HOST } from "@/lib/site";

const INTERNAL_HOSTS = new Set(
  [SITE_HOST, `www.${SITE_HOST}`, "mcmchat.ai", "www.mcmchat.ai", "mcmchat.id", "www.mcmchat.id"]
    .filter(Boolean)
    .map((h) => h.toLowerCase()),
);

/**
 * Kembalikan path internal (`/chat?x=1#y`) bila URL menunjuk ke aplikasi ini,
 * atau `null` bila link tersebut eksternal / bukan http(s).
 */
export function internalPathOf(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, typeof window === "undefined" ? "https://" + SITE_HOST : window.location.href);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const sameOrigin = typeof window !== "undefined" && host === window.location.hostname;
  if (!sameOrigin && !INTERNAL_HOSTS.has(host)) return null;
  return `${u.pathname}${u.search}${u.hash}` || "/";
}

/** Buka link eksternal di in-app browser aman (Custom Tabs / SFSafariViewController) atau tab baru. */
export async function openExternalLink(href: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: href, presentationStyle: "popover" });
      return;
    } catch {
      /* fallback ke window.open */
    }
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
