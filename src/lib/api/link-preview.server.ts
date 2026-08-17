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
  const o = parseIPv4Octets(host);
  return o ? [o[0]!, o[1]!] : null;
}

/** Semua 4 oktet dari literal IPv4 dalam bentuk apa pun. */
function parseIPv4Octets(host: string): number[] | null {
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
  return octets;
}

/** Ekspansi literal IPv6 (termasuk bentuk :: dan ekor IPv4) ke 8 hextet. */
function expandIPv6(input: string): number[] | null {
  let h = input.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.replace(/%[^\]]*$/, ""); // buang zone-id (fe80::1%eth0)
  if (!h.includes(":")) return null;
  let tailV4: number[] | null = null;
  const lastPart = h.split(":").pop() ?? "";
  if (lastPart.includes(".")) {
    const v4 = parseIPv4Octets(lastPart);
    if (!v4) return null;
    tailV4 = v4;
    h = h.slice(0, h.length - lastPart.length) + "0:0";
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const toNums = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toNums(halves[0] ?? "");
  const tail = halves.length === 2 ? toNums(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<number>(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tailV4) {
    groups[6] = (tailV4[0]! << 8) | tailV4[1]!;
    groups[7] = (tailV4[2]! << 8) | tailV4[3]!;
  }
  return groups;
}

/** True bila alamat IPv6 mengarah ke jaringan internal/khusus. */
export function isBlockedIPv6(host: string): boolean {
  const g = expandIPv6(host);
  if (!g) return host.includes(":"); // literal IPv6 tak terbaca = tolak
  const [a, b] = [g[0]!, g[1]!];
  const allZero = g.every((x) => x === 0);
  if (allZero) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped / -compat / 6to4 / NAT64 → validasi bagian IPv4-nya.
  const v4FromTail = (): [number, number] => [g[6]! >>> 8, g[6]! & 0xff];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    const [p, q] = v4FromTail();
    return isPrivateIPv4(p, q);
  }
  if (a === 0x2002) return isPrivateIPv4(b >>> 8, b & 0xff); // 6to4
  if (a === 0x0064 && b === 0xff9b) {
    const [p, q] = v4FromTail();
    return isPrivateIPv4(p, q); // NAT64
  }
  if ((a & 0xff00) === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64
  if ((a & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  if (a === 0x2001 && b === 0x0db8) return true; // dokumentasi
  if (a === 0x2001 && b <= 0x01ff) return true; // teredo/orchid/benchmark
  if ((a & 0xff00) === 0xff00) return true; // multicast
  return false;
}

const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * Validasi URL sebelum diambil server: hanya http(s) publik, port standar,
 * tanpa kredensial, dan bukan host internal/IP privat (v4 maupun v6).
 */
export function safeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!ALLOWED_PORTS.has(u.port)) return null;
  let host = u.hostname.toLowerCase();
  // Host ter-encode (%6c%6f%63%61%6c%68%6f%73%74) dan trailing dot dinormalkan
  // agar tidak melewati daftar blokir.
  try {
    host = decodeURIComponent(host);
  } catch {
    return null;
  }
  host = host.replace(/\.+$/, "");
  if (!host) return null;
  if (/\s/.test(host)) return null;
  if (host.includes(":") || host.startsWith("[")) {
    return isBlockedIPv6(host) ? null : u;
  }
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

const CACHE_TTL_OK = 1000 * 60 * 60 * 6;
const CACHE_TTL_FAIL = 1000 * 60 * 10;
const CACHE_MAX = 300;
const MAX_HOPS = 4;

type CacheEntry = { value: LinkPreview | null; expires: number };
const cache = new Map<string, CacheEntry>();

/** Kunci cache = URL yang sudah dinormalkan lewat safeUrl, bukan input mentah. */
function cacheKey(u: URL): string {
  const c = new URL(u.toString());
  c.hash = "";
  return c.toString();
}

function readCache(key: string): CacheEntry | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Entri lama tetap divalidasi ulang: aturan blokir bisa berubah, dan URL
  // hasil redirect yang tersimpan tidak boleh lolos hanya karena di-cache.
  if (hit.value && (!safeUrl(hit.value.url) || (hit.value.image && !safeUrl(hit.value.image)))) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit); // LRU refresh
  return hit;
}

function writeCache(key: string, value: LinkPreview | null): void {
  cache.set(key, { value, expires: Date.now() + (value ? CACHE_TTL_OK : CACHE_TTL_FAIL) });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Hanya untuk pengujian: kosongkan cache pratinjau. */
export function __clearPreviewCache(): void {
  cache.clear();
}

/** Ambil HTML halaman (dibatasi ukuran & waktu) lalu baca meta OG/Twitter. */
export async function unfurl(rawUrl: string): Promise<LinkPreview | null> {
  const first = safeUrl(rawUrl);
  if (!first) return null;
  const key = cacheKey(first);
  const cached = readCache(key);
  if (cached) return cached.value;
  const result = await unfurlUncached(first);
  writeCache(key, result);
  return result;
}

async function unfurlUncached(start: URL): Promise<LinkPreview | null> {
  let u = start;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const visited = new Set<string>([cacheKey(u)]);
  try {
    // Redirect ditangani manual: setiap hop divalidasi ulang agar tujuan
    // internal tidak bisa dicapai lewat pengalihan (termasuk rantai panjang).
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
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
        if (hop === MAX_HOPS) return null; // rantai redirect terlalu panjang
        const loc = r.headers.get("location");
        if (!loc || loc.length > 2000) return null;
        let resolved: string;
        try {
          resolved = new URL(loc, u).toString();
        } catch {
          return null;
        }
        const next = safeUrl(resolved);
        if (!next) return null;
        if (u.protocol === "https:" && next.protocol === "http:") return null; // downgrade
        const nextKey = cacheKey(next);
        if (visited.has(nextKey)) return null; // loop redirect
        visited.add(nextKey);
        u = next;
        continue;
      }
      res = r;
      break;
    }
    if (!res || !res.ok) return null;
    const finalUrl = safeUrl(res.url || u.toString());
    if (!finalUrl) return null;
    u = finalUrl;
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
