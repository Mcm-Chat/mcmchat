import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sendEach } from "../fcm.server";
import type { PushData } from "../payload";

const KEY = "FCM_SERVICE_ACCOUNT_JSON";
let pem = "";

function toPem(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  pem = toPem(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
});

type Sent = { url: string; body: Record<string, never> };

function mockFcm(handler: (token: string) => { status: number; body?: unknown }) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "ya29.mock", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body));
    sent.push({ url, body });
    const out = handler(body.message.token);
    return new Response(JSON.stringify(out.body ?? {}), {
      status: out.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  return sent;
}

const data = (): PushData => ({
  kind: "message",
  channel: "mcm_messages",
  group: "c1",
  route: "/chat/c1",
  title: "Ani",
  body: "Halo",
});

const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  vi.restoreAllMocks();
});

function configure() {
  process.env[KEY] = JSON.stringify({
    project_id: "mcm-demo",
    client_email: "push@mcm-demo.iam.gserviceaccount.com",
    private_key: pem,
  });
}

describe("pengiriman FCM HTTP v1", () => {
  it("mengirim data-only per perangkat dengan TTL, collapse key, dan extra masing-masing", async () => {
    configure();
    const sent = mockFcm(() => ({ status: 200 }));
    const res = await sendEach([
      { token: "tokA", sound: true, vibrate: false, data: data(), ttlSeconds: 45, collapseKey: "call-1", extra: { answerToken: "A" } },
      { token: "tokB", sound: false, vibrate: true, data: data(), ttlSeconds: 600, extra: { answerToken: "B" } },
    ]);

    expect(res).toMatchObject({ configured: true, sent: 2, failed: 0, invalidTokens: [] });
    expect(sent).toHaveLength(2);
    const a = sent[0]!.body as unknown as { message: Record<string, never> };
    const msgA = a.message as unknown as {
      token: string;
      data: Record<string, string>;
      android: { priority: string; ttl: string; collapseKey?: string };
      notification?: unknown;
    };
    expect(msgA.token).toBe("tokA");
    expect(msgA.notification).toBeUndefined();
    expect(msgA.android).toMatchObject({ priority: "HIGH", ttl: "45s", collapseKey: "call-1" });
    expect(msgA.data).toMatchObject({ kind: "message", channel: "mcm_messages", sound: "1", vibrate: "0", answerToken: "A" });

    const msgB = (sent[1]!.body as unknown as { message: { android: { ttl: string; collapseKey?: string }; data: Record<string, string> } }).message;
    expect(msgB.android.ttl).toBe("600s");
    expect(msgB.android.collapseKey).toBeUndefined();
    expect(msgB.data["answerToken"]).toBe("B");
    expect(msgB.data["sound"]).toBe("0");
  });

  it("menjepit TTL ke rentang 1s–24 jam", async () => {
    configure();
    const sent = mockFcm(() => ({ status: 200 }));
    await sendEach([
      { token: "t1", sound: true, vibrate: true, data: data(), ttlSeconds: 0 },
      { token: "t2", sound: true, vibrate: true, data: data(), ttlSeconds: 999_999 },
      { token: "t3", sound: true, vibrate: true, data: data() },
    ]);
    const ttls = sent.map((s) => (s.body as unknown as { message: { android: { ttl: string } } }).message.android.ttl);
    expect(ttls).toEqual(["1s", "86400s", "86400s"]);
  });

  it("hanya memangkas token yang benar-benar mati", async () => {
    configure();
    mockFcm((token) =>
      token === "dead"
        ? { status: 404, body: { error: { status: "NOT_FOUND" } } }
        : token === "quota"
          ? { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }
          : { status: 200 },
    );
    const res = await sendEach(
      ["dead", "quota", "ok"].map((token) => ({ token, sound: true, vibrate: true, data: data() })),
    );
    expect(res.invalidTokens).toEqual(["dead"]);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(2);
    expect(res.outcomes.find((o) => o.token === "quota")).toMatchObject({ ok: false, deadToken: false });
  });

  it("kegagalan jaringan tidak pernah menandai token mati", async () => {
    configure();
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown) => {
      if (String(input).includes("oauth2.googleapis.com"))
        return new Response(JSON.stringify({ access_token: "ya29.mock", expires_in: 3600 }), { status: 200 });
      throw new Error("network down");
    }) as typeof fetch);
    const res = await sendEach([{ token: "t1", sound: true, vibrate: true, data: data() }]);
    expect(res).toMatchObject({ configured: true, sent: 0, failed: 1, invalidTokens: [] });
    expect(res.outcomes[0]).toMatchObject({ deadToken: false });
  });

  it("gagal OAuth dilaporkan tanpa memangkas token", async () => {
    // Service account berbeda supaya cache access token test sebelumnya tidak dipakai.
    process.env[KEY] = JSON.stringify({
      project_id: "mcm-lain",
      client_email: "rotasi@mcm-lain.iam.gserviceaccount.com",
      private_key: pem,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch);
    const res = await sendEach([{ token: "t1", sound: true, vibrate: true, data: data() }]);
    expect(res.configured).toBe(true);
    expect(res.invalidTokens).toEqual([]);
    expect(res.failed).toBe(1);
    expect(res.reason).toContain("fcm_oauth_failed");
  });
});
