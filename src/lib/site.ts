/**
 * Satu-satunya sumber kebenaran untuk base URL produksi MCM.
 *
 * Ganti lewat env `VITE_SITE_URL` bila domain kanonis berubah. Domain kanonis
 * adalah apex tanpa `www`: https://mcmchat.id (host `www` di-redirect 301 ke apex
 * oleh `src/server.ts`).
 */
export const SITE_URL: string = (import.meta.env["VITE_SITE_URL"] ?? "https://mcmchat.ai").replace(
  /\/+$/,
  "",
);

export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");

/** URL absolut untuk canonical / og:url / sitemap. */
export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * URL yang dibagikan ke orang lain (tautan perintah penyiapan, QR, dsb).
 *
 * Selalu memakai domain produksi, KECUALI saat dijalankan di localhost
 * (pengembangan) agar tautan tetap bisa dibuka di mesin yang sama. Tanpa ini,
 * tautan yang dibuat dari host pratinjau ikut tersimpan di riwayat chat dan
 * penerima mendapat halaman gagal dimuat.
 */
export function shareUrl(path: string): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
    }
  }
  return absoluteUrl(path);
}

/** Gambar pratinjau sosial (absolut, https). */
export const OG_IMAGE = absoluteUrl("/icon-512.png");

/**
 * Meta + link kanonis untuk sebuah route publik.
 * Dipakai di `head()` agar canonical/og:url selalu memakai domain produksi.
 */
export function canonical(path: string) {
  const url = absoluteUrl(path);
  return {
    meta: [
      { property: "og:url", content: url },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
