/**
 * Bagikan teks ke aplikasi lain (WhatsApp, Gmail, dsb) lewat Web Share API.
 * Bila perangkat/browser tidak mendukung, teks disalin ke papan klip agar
 * pengguna tetap bisa menempelkannya secara manual.
 */
import { toast } from "sonner";

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

export async function shareToApps(opts: {
  title?: string;
  text: string;
  url?: string | undefined;
}): Promise<ShareResult> {
  const payload = {
    ...(opts.title ? { title: opts.title } : {}),
    text: opts.text,
    ...(opts.url ? { url: opts.url } : {}),
  };
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav?.share) {
    try {
      await nav.share(payload);
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  const full = opts.url ? `${opts.text}\n${opts.url}` : opts.text;
  try {
    await nav?.clipboard?.writeText(full);
    toast.success("Disalin — tempel di aplikasi tujuan");
    return "copied";
  } catch {
    toast.error("Tidak bisa membagikan di perangkat ini");
    return "failed";
  }
}
