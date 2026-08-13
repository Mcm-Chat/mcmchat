/**
 * Header keamanan HTTP + redirect kanonis untuk MCM produksi.
 *
 * Kanonis: apex `https://mcmchat.ai`. Host `www.` di-redirect 301 ke apex
 * (tanpa loop: redirect hanya terjadi bila host diawali `www.`).
 *
 * CSP sengaja mengizinkan `https:` dan `wss:` pada `connect-src` supaya
 * Supabase (REST/Realtime/Storage), LiveKit (WebRTC SFU + signaling wss),
 * dan FCM tetap berfungsi tanpa daftar host yang gampang basi.
 */

/** Host preview/dev tidak boleh kena redirect kanonis. */
function isCanonicalWww(hostname: string): boolean {
  return (
    hostname.startsWith("www.") &&
    (hostname.endsWith("mcmchat.ai") || hostname.endsWith("mcmchat.id"))
  );
}

export function canonicalRedirect(request: Request): Response | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (!isCanonicalWww(url.hostname)) return null;
  url.hostname = url.hostname.slice(4);
  url.protocol = "https:";
  url.port = "";
  return new Response(null, { status: 301, headers: { location: url.toString() } });
}

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Vite/TanStack Start menyuntikkan script inline saat hydration.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  // Supabase REST/Realtime, LiveKit signaling+TURN, FCM.
  "connect-src 'self' https: wss: blob: data:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "geolocation=(self)",
  "display-capture=(self)",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

export function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const contentType = headers.get("content-type") ?? "";
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (contentType.includes("text/html")) headers.set("Content-Security-Policy", CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
