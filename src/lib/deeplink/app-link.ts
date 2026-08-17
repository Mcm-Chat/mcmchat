import { isValidPin, normalizePin } from "@/lib/api/contacts";

/** Host resmi MCM yang boleh membawa deep link ke dalam aplikasi. */
const MCM_HOSTS = new Set([
  "mcmchat.id",
  "www.mcmchat.id",
  "mcmchat.ai",
  "www.mcmchat.ai",
  "mcmchat.lovable.app",
]);

/** Bagian pertama path yang benar-benar ada sebagai rute aplikasi. */
const ALLOWED_SECTIONS = new Set([
  "chat",
  "call",
  "calls",
  "contacts",
  "status",
  "tasks",
  "prepare",
  "ledger",
  "catalog",
  "finance",
  "profile",
  "settings",
  "premium",
  "support",
  "delete-account",
  "download",
  "privacy",
  "terms",
  "home",
]);

function contactRoute(rawPin: string): string | null {
  const pin = normalizePin(decodeURIComponent(rawPin));
  return isValidPin(pin) ? `/contacts/add?pin=${encodeURIComponent(pin)}` : null;
}

/**
 * Ubah URL App Link (`https://mcmchat.id/...`), skema aplikasi
 * (`mcm://contact/<pin>`), atau path mentah menjadi rute internal aplikasi.
 *
 * Mengembalikan `null` bila tautan bukan milik MCM atau menunjuk ke bagian
 * yang tidak ada — pemanggil boleh mengabaikannya alih-alih membuka layar
 * kosong.
 */
export function resolveAppLink(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // Skema aplikasi: mcm://contact/<pin>, mcm://pin/<pin>, mcm://chat/<id>
  const scheme = /^mcm:\/\/(.+)$/i.exec(text);
  if (scheme) return fromPath("/" + (scheme[1] ?? "").replace(/^\/+/, ""));

  if (text.startsWith("/")) return text.startsWith("//") ? null : fromPath(text);

  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!MCM_HOSTS.has(host) && !host.endsWith(".lovable.app")) return null;
  return fromPath(`${url.pathname}${url.search}${url.hash}`);
}

function fromPath(pathWithQuery: string): string | null {
  const [pathAndHash] = [pathWithQuery];
  const hashAt = pathAndHash.indexOf("#");
  const hash = hashAt >= 0 ? pathAndHash.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? pathAndHash.slice(0, hashAt) : pathAndHash;
  const qAt = noHash.indexOf("?");
  const query = qAt >= 0 ? noHash.slice(qAt) : "";
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "/";

  const section = (segments[0] ?? "").toLowerCase();

  // Tautan undangan kontak: /contact/<pin>, /pin/<pin>, /c/<pin>
  if (section === "contact" || section === "pin" || section === "c") {
    return segments[1] ? contactRoute(segments[1]) : "/contacts/add";
  }

  if (!ALLOWED_SECTIONS.has(section)) return null;
  return `/${segments.join("/")}${query}${hash}`;
}
