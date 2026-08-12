/**
 * Pembuat token akses LiveKit untuk runtime Worker (tanpa dependensi Node).
 *
 * Secret `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` hanya dibaca di server.
 * Bila belum diisi, seluruh fungsi melaporkan "belum terhubung" — tidak ada
 * token palsu dan tidak ada panggilan yang disimulasikan.
 */
export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

export function readLiveKitConfig(): LiveKitConfig | null {
  const url = process.env["LIVEKIT_URL"];
  const apiKey = process.env["LIVEKIT_API_KEY"];
  const apiSecret = process.env["LIVEKIT_API_SECRET"];
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
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
};

/** JWT HS256 dengan grant LiveKit standar. Tidak pernah dikirim ke pihak lain. */
export async function mintAccessToken(cfg: LiveKitConfig, opts: GrantOptions): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.min(3600, Math.max(60, opts.ttlSec ?? 900));
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: cfg.apiKey,
    sub: opts.identity,
    nbf: now - 10,
    exp,
    name: opts.name,
    video: {
      room: opts.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: opts.canPublishVideo ? ["microphone", "camera", "screen_share"] : ["microphone"],
    },
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cfg.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${b64url(sig)}`, expiresAt: exp * 1000 };
}
