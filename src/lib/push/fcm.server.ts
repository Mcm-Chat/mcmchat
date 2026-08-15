/**
 * Pengirim FCM HTTP v1 untuk runtime Worker (tanpa dependensi Node-only).
 * Kredensial dibaca dari secret `FCM_SERVICE_ACCOUNT_JSON`; bila belum ada,
 * seluruh pengiriman dilaporkan sebagai "belum terhubung" — tidak ada push
 * palsu dan tidak ada secret yang pernah dicatat ke log.
 */
import type { PushData } from "./payload";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

/** Alasan konfigurasi yang aman ditampilkan ke UI (tidak pernah memuat secret). */
export type PushConfigStatus =
  | { configured: true }
  | {
      configured: false;
      code: "missing" | "invalid_json" | "incomplete" | "invalid_private_key";
      reason: string;
    };

const CONFIG_REASONS: Record<
  Exclude<Extract<PushConfigStatus, { configured: false }>["code"], never>,
  string
> = {
  missing: "FCM_SERVICE_ACCOUNT_JSON belum diatur",
  invalid_json: "FCM_SERVICE_ACCOUNT_JSON bukan JSON service account yang valid",
  incomplete: "Service account tidak lengkap (butuh project_id, client_email, private_key)",
  invalid_private_key: "private_key service account bukan blok PEM yang valid",
};

export type FcmResult = {
  configured: boolean;
  sent: number;
  failed: number;
  invalidTokens: string[];
  reason?: string;
};

/** Hasil per-pesan, dipakai pemanggil untuk mencabut token aksi yang gagal kirim. */
export type PushOutcome = { token: string; ok: boolean; deadToken: boolean };
export type FcmEachResult = FcmResult & { outcomes: PushOutcome[] };

/**
 * Normalisasi private key: secret sering disimpan dengan `\n` literal (hasil
 * copy dari JSON) atau dengan CRLF. Keduanya harus menjadi newline asli supaya
 * blok PEM bisa dibaca Web Crypto.
 */
function normalizePrivateKey(key: string): string {
  return key.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();
}

function parseServiceAccount(raw: string): ServiceAccount | { error: PushConfigStatus } {
  const trimmed = raw.trim();
  // Secret boleh disimpan sebagai JSON mentah atau base64 dari JSON itu.
  let text = trimmed;
  if (!trimmed.startsWith("{")) {
    try {
      text = atob(trimmed.replace(/\s+/g, ""));
    } catch {
      return {
        error: { configured: false, code: "invalid_json", reason: CONFIG_REASONS.invalid_json },
      };
    }
  }
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    return {
      error: { configured: false, code: "invalid_json", reason: CONFIG_REASONS.invalid_json },
    };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.client_email ||
    !parsed.private_key ||
    !parsed.project_id
  ) {
    return { error: { configured: false, code: "incomplete", reason: CONFIG_REASONS.incomplete } };
  }
  const private_key = normalizePrivateKey(String(parsed.private_key));
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(private_key)) {
    return {
      error: {
        configured: false,
        code: "invalid_private_key",
        reason: CONFIG_REASONS.invalid_private_key,
      },
    };
  }
  return {
    client_email: String(parsed.client_email).trim(),
    project_id: String(parsed.project_id).trim(),
    private_key,
  };
}

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env["FCM_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  const parsed = parseServiceAccount(raw);
  return "error" in parsed ? null : parsed;
}

/** Diagnosa konfigurasi push tanpa pernah membocorkan isi secret. */
export function pushConfigStatus(): PushConfigStatus {
  const raw = process.env["FCM_SERVICE_ACCOUNT_JSON"];
  if (!raw || !raw.trim())
    return { configured: false, code: "missing", reason: CONFIG_REASONS.missing };
  const parsed = parseServiceAccount(raw);
  return "error" in parsed ? parsed.error : { configured: true };
}

export function pushConfigured(): boolean {
  return pushConfigStatus().configured;
}

/** Batas waktu setiap panggilan jaringan ke Google (OAuth + FCM). */
const FETCH_TIMEOUT_MS = 10_000;

function timeoutSignal(ms = FETCH_TIMEOUT_MS): AbortSignal {
  // AbortSignal.timeout tersedia di Worker; fallback manual untuk runtime lama.
  const anyAbort = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof anyAbort.timeout === "function") return anyAbort.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken: { token: string; exp: number; owner: string } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const owner = `${sa.project_id}:${sa.client_email}`;
  // Cache harus terikat service account; rotasi kredensial tidak boleh memakai
  // access token lama.
  if (cachedToken && cachedToken.owner === owner && now < cachedToken.exp - 60)
    return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const assertion = `${header}.${claim}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: timeoutSignal(),
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`fcm_oauth_failed_${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, exp: now + json.expires_in, owner };
  return json.access_token;
}

export type PushTarget = {
  token: string;
  sound: boolean;
  vibrate: boolean;
  /** Field tambahan khusus perangkat ini (mis. token aksi sekali-pakai). */
  extra?: Record<string, string>;
};

/** Pesan lengkap untuk SATU perangkat (payload + TTL + collapse key sendiri). */
export type PushMessage = PushTarget & {
  data: PushData;
  ttlSeconds?: number;
  collapseKey?: string;
};

/**
 * Hanya error yang benar-benar berarti "token tidak berlaku lagi" yang boleh
 * menghapus token. Bug payload (INVALID_ARGUMENT pada field lain, quota,
 * server error) TIDAK boleh membuang token pengguna yang valid.
 */
export function isDeadTokenError(status: number, body: unknown): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  const err = (
    body as {
      error?: { status?: string; details?: { errorCode?: string }[]; message?: string };
    } | null
  )?.error;
  if (!err) return false;
  const codes = new Set<string>();
  if (err.status) codes.add(err.status);
  for (const d of err.details ?? []) if (d.errorCode) codes.add(d.errorCode);
  if (codes.has("UNREGISTERED") || codes.has("NOT_FOUND") || codes.has("SENDER_ID_MISMATCH"))
    return true;
  // INVALID_ARGUMENT hanya dianggap token mati bila memang menyebut field token.
  if (codes.has("INVALID_ARGUMENT"))
    return /registration token|message\.token|not a valid FCM/i.test(err.message ?? "");
  return false;
}

/**
 * Kirim data-only message (prioritas tinggi) agar receiver native yang
 * membangun notifikasi — termasuk aksi Balas / Tandai dibaca — tetap jalan
 * saat proses aplikasi mati.
 */
export async function sendPush(
  targets: PushTarget[],
  data: PushData,
  options?: { ttlSeconds?: number; collapseKey?: string },
): Promise<FcmResult> {
  const { outcomes: _o, ...rest } = await sendEach(
    targets.map((t) => ({
      token: t.token,
      sound: t.sound,
      vibrate: t.vibrate,
      data,
      ...(t.extra ? { extra: t.extra } : {}),
      ...(options?.ttlSeconds !== undefined ? { ttlSeconds: options.ttlSeconds } : {}),
      ...(options?.collapseKey ? { collapseKey: options.collapseKey } : {}),
    })),
  );
  return rest;
}

/**
 * Satu payload + satu TTL PER PERANGKAT. Wajib dipakai untuk notifikasi
 * yang membawa token aksi sekali-pakai: token perangkat A tidak boleh
 * pernah ikut terkirim ke perangkat B.
 */
export async function sendEach(messages: PushMessage[]): Promise<FcmEachResult> {
  const status = pushConfigStatus();
  const sa = readServiceAccount();
  if (!sa || !status.configured) {
    return {
      configured: false,
      sent: 0,
      failed: 0,
      invalidTokens: [],
      outcomes: [],
      reason: status.configured ? CONFIG_REASONS.missing : status.reason,
    };
  }
  if (messages.length === 0)
    return { configured: true, sent: 0, failed: 0, invalidTokens: [], outcomes: [] };

  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (err) {
    // Gagal ambil access token = tidak ada satu pun token perangkat yang salah.
    return {
      configured: true,
      sent: 0,
      failed: messages.length,
      invalidTokens: [],
      outcomes: messages.map((m) => ({ token: m.token, ok: false, deadToken: false })),
      reason: err instanceof Error ? err.message : "fcm_oauth_failed",
    };
  }
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const invalidTokens: string[] = [];
  const outcomes: PushOutcome[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    messages.map(async (t) => {
      const ttl = `${Math.max(1, Math.min(86400, Math.round(t.ttlSeconds ?? 86400)))}s`;
      const payload: Record<string, string> = { ...(t.data as unknown as Record<string, string>) };
      for (const [k, v] of Object.entries(t.extra ?? {})) payload[k] = v;
      payload["sound"] = t.sound ? "1" : "0";
      payload["vibrate"] = t.vibrate ? "1" : "0";
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          signal: timeoutSignal(),
          body: JSON.stringify({
            message: {
              token: t.token,
              data: payload,
              android: {
                priority: "HIGH",
                ttl,
                ...(t.collapseKey ? { collapseKey: t.collapseKey } : {}),
                // Data-only: notifikasi dibangun receiver native (channel + actions).
              },
            },
          }),
        });
      } catch {
        // Timeout / gangguan jaringan: gagal kirim, TAPI token tetap valid.
        failed += 1;
        outcomes.push({ token: t.token, ok: false, deadToken: false });
        return;
      }
      if (res.ok) {
        sent += 1;
        outcomes.push({ token: t.token, ok: true, deadToken: false });
        return;
      }
      failed += 1;
      const body = await res.json().catch(() => null);
      const dead = isDeadTokenError(res.status, body);
      if (dead) invalidTokens.push(t.token);
      outcomes.push({ token: t.token, ok: false, deadToken: dead });
    }),
  );

  return { configured: true, sent, failed, invalidTokens, outcomes };
}
