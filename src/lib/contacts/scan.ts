import { isValidPin, normalizePin } from "@/lib/api/contacts";

/** Host MCM resmi yang boleh membawa PIN kontak lewat tautan HTTPS. */
const MCM_HOSTS = new Set([
  "mcmchat.id",
  "www.mcmchat.id",
  "mcmchat.ai",
  "www.mcmchat.ai",
  "mcmchat.lovable.app",
]);

function pinOrNull(value: string): string | null {
  const pin = normalizePin(value);
  return isValidPin(pin) ? pin : null;
}

/**
 * Ubah isi QR/barcode menjadi PIN MCM.
 *
 * Menerima PIN mentah, skema `mcm://contact/<pin>` (juga `mcm://pin/<pin>`),
 * tautan HTTPS domain MCM `/contact/<pin>`, dan payload JSON versi MCM.
 * Payload asing (tautan lain, teks bebas, JSON non-MCM) ditolak.
 */
export function parseContactScan(raw: string): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // 1. Payload JSON versi MCM.
  if (text.startsWith("{")) {
    try {
      const json = JSON.parse(text) as { type?: unknown; t?: unknown; pin?: unknown };
      const type = String(json.type ?? json.t ?? "").toLowerCase();
      if (type !== "mcm.contact" && type !== "mcm_contact") return null;
      return typeof json.pin === "string" ? pinOrNull(json.pin) : null;
    } catch {
      return null;
    }
  }

  // 2. Skema aplikasi mcm://contact/<pin> atau mcm://pin/<pin>.
  const scheme = text.match(/^mcm:\/\/(contact|pin)\/([^/?#\s]+)/i);
  if (scheme?.[2]) return pinOrNull(decodeURIComponent(scheme[2]));

  // 3. Tautan HTTPS domain MCM.
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (!MCM_HOSTS.has(url.hostname.toLowerCase())) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length !== 2) return null;
      const [section, value] = segments;
      if (!/^(contact|pin|c)$/i.test(section ?? "")) return null;
      return pinOrNull(decodeURIComponent(value ?? ""));
    } catch {
      return null;
    }
  }

  // 4. PIN mentah (tidak ada pencocokan longgar di dalam teks bebas).
  if (/^[0-9A-Za-z\s-]{8,12}$/.test(text)) return pinOrNull(text);
  return null;
}
