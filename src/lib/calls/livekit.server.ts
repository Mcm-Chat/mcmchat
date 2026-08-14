/**
 * Pembuat token akses LiveKit untuk runtime Worker (tanpa dependensi Node).
 *
 * Secret `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` hanya dibaca di server.
 * Bila belum diisi ATAU URL tidak valid, seluruh fungsi melaporkan "belum
 * terhubung" — tidak ada token palsu dan tidak ada panggilan yang disimulasikan.
 */
export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

/** URL penyedia wajib WebSocket aman; tiga string terisi saja tidak cukup. */
export function isValidLiveKitUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "wss:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export function validateLiveKitConfig(raw: {
  url?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
}): { ok: true; config: LiveKitConfig } | { ok: false; code: string } {
  const url = raw.url?.trim() ?? "";
  const apiKey = raw.apiKey?.trim() ?? "";
  const apiSecret = raw.apiSecret?.trim() ?? "";
  if (!url || !apiKey || !apiSecret) return { ok: false, code: "provider_unconfigured" };
  if (!isValidLiveKitUrl(url)) return { ok: false, code: "provider_url_invalid" };
  return { ok: true, config: { url, apiKey, apiSecret } };
}

export function readLiveKitConfigResult() {
  return validateLiveKitConfig({
    url: process.env["LIVEKIT_URL"],
    apiKey: process.env["LIVEKIT_API_KEY"],
    apiSecret: process.env["LIVEKIT_API_SECRET"],
  });
}

export function readLiveKitConfig(): LiveKitConfig | null {
  const r = readLiveKitConfigResult();
  return r.ok ? r.config : null;
}

export function liveKitConfigured(): boolean {
  return readLiveKitConfig() !== null;
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type GrantOptions = {
  room: string;
  identity: string;
  name: string;
  /** Video hanya boleh dipublikasikan pada panggilan video. */
  canPublishVideo: boolean;
  /** Masa berlaku token dalam detik (pendek — token bukan sesi). */
  ttlSec?: number;
  /** Token diagnostik: hanya boleh menyambung, tanpa media atau data. */
  observerOnly?: boolean;
};

/** Payload JWT (murni, tanpa secret di dalamnya selain `iss` = API key). */
export function buildTokenPayload(cfg: LiveKitConfig, opts: GrantOptions, nowSec: number) {
  const exp = nowSec + Math.min(3600, Math.max(30, opts.ttlSec ?? 900));
  return {
    iss: cfg.apiKey,
    sub: opts.identity,
    nbf: nowSec - 10,
    exp,
    name: opts.name,
    video: opts.observerOnly
      ? {
          room: opts.room,
          roomJoin: true,
          canPublish: false,
          canSubscribe: false,
          canPublishData: false,
          canPublishSources: [] as string[],
        }
      : {
          room: opts.room,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          canPublishSources: opts.canPublishVideo
            ? ["microphone", "camera", "screen_share"]
            : ["microphone"],
        },
  };
}

/** JWT HS256 dengan grant LiveKit standar. Tidak pernah dikirim ke pihak lain. */
export async function mintAccessToken(
  cfg: LiveKitConfig,
  opts: GrantOptions,
): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const payload = buildTokenPayload(cfg, opts, now);
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cfg.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${b64url(sig)}`, expiresAt: payload.exp * 1000 };
}
