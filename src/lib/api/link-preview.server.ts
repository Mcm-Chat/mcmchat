/** Unfurl metadata Open Graph untuk kartu pratinjau link di chat. */
export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const BLOCKED_HOST =
  /^(localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$|.*\.internal$)/i;

export function safeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (BLOCKED_HOST.test(u.hostname)) return null;
  return u;
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

function metaOf(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    if (!tag) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decode(content).slice(0, 400);
  }
  return null;
}

/** Ambil HTML halaman (dibatasi ukuran & waktu) lalu baca meta OG/Twitter. */
export async function unfurl(rawUrl: string): Promise<LinkPreview | null> {
  const u = safeUrl(rawUrl);
  if (!u) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(u.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; MCMBot/1.0; +https://mcmchat.ai)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "id,en;q=0.8",
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    const raw = await res.text();
    const html = raw.slice(0, 300_000);
    const title =
      metaOf(html, ["og:title", "twitter:title"]) ??
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ? decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]!).slice(0, 200)
        : null);
    const description = metaOf(html, ["og:description", "twitter:description", "description"]);
    const rawImage = metaOf(html, ["og:image:secure_url", "og:image", "twitter:image"]);
    let image: string | null = null;
    if (rawImage) {
      const abs = safeUrl(new URL(rawImage, u).toString());
      image = abs ? abs.toString() : null;
    }
    const siteName = metaOf(html, ["og:site_name"]) ?? u.hostname.replace(/^www\./, "");
    if (!title && !description && !image) return null;
    return { url: u.toString(), title, description, image, siteName };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
