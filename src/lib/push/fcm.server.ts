/**
 * Pengirim FCM HTTP v1 untuk runtime Worker (tanpa dependensi Node-only).
 * Kredensial dibaca dari secret `FCM_SERVICE_ACCOUNT_JSON`; bila belum ada,
 * seluruh pengiriman dilaporkan sebagai "belum terhubung" — tidak ada push
 * palsu dan tidak ada secret yang pernah dicatat ke log.
 */
import type { PushData } from "./payload";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

export type FcmResult = {
  configured: boolean;
  sent: number;
  failed: number;
  invalidTokens: string[];
  reason?: string;
};

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env["FCM_SERVICE_ACCOUNT_JSON"];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pushConfigured(): boolean {
  return readServiceAccount() !== null;
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

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < cachedToken.exp - 60) return cachedToken.token;

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
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`fcm_oauth_failed_${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

export type PushTarget = { token: string; sound: boolean; vibrate: boolean };

/**
 * Kirim data-only message (prioritas tinggi) agar receiver native yang
 * membangun notifikasi — termasuk aksi Balas / Tandai dibaca — tetap jalan
 * saat proses aplikasi mati.
 */
export async function sendPush(targets: PushTarget[], data: PushData): Promise<FcmResult> {
  const sa = readServiceAccount();
  if (!sa) {
    return { configured: false, sent: 0, failed: 0, invalidTokens: [], reason: "FCM_SERVICE_ACCOUNT_JSON belum diatur" };
  }
  if (targets.length === 0) return { configured: true, sent: 0, failed: 0, invalidTokens: [] };

  const bearer = await accessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const invalidTokens: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    targets.map(async (t) => {
      const payload: Record<string, string> = { ...(data as unknown as Record<string, string>) };
      payload["sound"] = t.sound ? "1" : "0";
      payload["vibrate"] = t.vibrate ? "1" : "0";
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: t.token,
            data: payload,
            android: {
              priority: "HIGH",
              ttl: "86400s",
              // Data-only: notifikasi dibangun receiver native (channel + actions).
            },
          },
        }),
      });
      if (res.ok) {
        sent += 1;
        return;
      }
      failed += 1;
      if (res.status === 404 || res.status === 400) invalidTokens.push(t.token);
    }),
  );

  return { configured: true, sent, failed, invalidTokens };
}
