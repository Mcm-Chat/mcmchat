/** Unfurl metadata Open Graph untuk kartu pratinjau link di chat. */
export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

/** Nama host internal/khusus yang tidak boleh pernah diambil dari server. */
const BLOCKED_SUFFIX =
  /(^|\.)(local|internal|localhost|localdomain|home|lan|intranet|corp|test|example|invalid|onion)$/i;

function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0/24 + 192.0.2/24
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    a >= 224 // multicast + reserved
  );
}

/**
 * Ubah literal IP dalam bentuk apa pun (desimal, heksadesimal, oktal, kelas
 * pendek) menjadi 4 oktet. Mengembalikan null bila host bukan literal IPv4.
 */
function parseIPv4(host: string): [number, number] | null {
  const parts = host.split(".");
  if (parts.length > 4 || parts.some((p) => p === "")) return null;
  const nums: number[] = [];
  for (const p of parts) {
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }
  // Bentuk gabungan (mis. 2130706433 atau 127.1) diperluas ke 32-bit penuh.
  const last = nums[nums.length - 1]!;
  const head = nums.slice(0, -1);
  if (head.some((n) => n > 255)) return null;
  const rest = 4 - head.length;
  if (last >= 2 ** (8 * rest)) return null;
  const octets = [...head];
  for (let i = rest - 1; i >= 0; i--) octets.push((last >>> (8 * i)) & 0xff);
  return [octets[0]!, octets[1]!];
}

function isBlockedIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  // IPv4-mapped/compat (::ffff:169.254.169.254) ikut divalidasi sebagai IPv4.
  const tail = h.split(":").pop() ?? "";
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4 || isPrivateIPv4(v4[0], v4[1])) return true;
  }
  if (h === "::" || h === "::1") return true;
  // unique-local (fc00::/7) dan link-local (fe80::/10)
  return /^(f[cd]|fe[89ab])/i.test(h);
}

export function safeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  if (isBlockedIPv6(host)) return null;
  const v4 = parseIPv4(host);
  if (v4) {
    if (isPrivateIPv4(v4[0], v4[1])) return null;
    return u;
  }
  if (!host.includes(".")) return null;
  if (BLOCKED_SUFFIX.test(host)) return null;
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
  let u = safeUrl(rawUrl);
  if (!u) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // Redirect ditangani manual: setiap hop divalidasi ulang agar tujuan
    // internal tidak bisa dicapai lewat pengalihan.
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const r: Response = await fetch(u.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; MCMBot/1.0; +https://mcmchat.ai)",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "id,en;q=0.8",
        },
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) return null;
        const next = safeUrl(new URL(loc, u).toString());
        if (!next) return null;
        u = next;
        continue;
      }
      res = r;
      break;
    }
    if (!res || !res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > 2_000_000) return null;
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
