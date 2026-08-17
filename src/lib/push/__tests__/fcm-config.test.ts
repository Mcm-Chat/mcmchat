import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushConfigStatus, pushConfigured, sendEach } from "../fcm.server";

const KEY = "FCM_SERVICE_ACCOUNT_JSON";
const PEM = "-----BEGIN PRIVATE KEY-----\\nMIIBmock\\n-----END PRIVATE KEY-----\\n";

function account(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    project_id: "mcm-demo",
    client_email: "push@mcm-demo.iam.gserviceaccount.com",
    private_key: PEM,
    ...extra,
  });
}

const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  vi.restoreAllMocks();
});

describe("konfigurasi FCM", () => {
  it("melaporkan belum diatur saat secret kosong", () => {
    delete process.env[KEY];
    expect(pushConfigStatus()).toEqual({
      configured: false,
      code: "missing",
      reason: expect.stringContaining("FCM_SERVICE_ACCOUNT_JSON"),
    });
    expect(pushConfigured()).toBe(false);
  });

  it("menerima JSON mentah dengan private_key ber-newline escaped", () => {
    process.env[KEY] = account();
    expect(pushConfigStatus()).toEqual({ configured: true });
  });

  it("menerima service account yang disimpan sebagai base64", () => {
    process.env[KEY] = btoa(account());
    expect(pushConfigured()).toBe(true);
  });

  it("menolak JSON rusak, field kurang, dan private_key bukan PEM", () => {
    process.env[KEY] = "{bukan json";
    expect(pushConfigStatus()).toMatchObject({ code: "invalid_json" });
    process.env[KEY] = JSON.stringify({ project_id: "x" });
    expect(pushConfigStatus()).toMatchObject({ code: "incomplete" });
    process.env[KEY] = account({ private_key: "rahasia-bukan-pem" });
    expect(pushConfigStatus()).toMatchObject({ code: "invalid_private_key" });
  });

  it("alasan konfigurasi tidak pernah memuat isi secret", () => {
    process.env[KEY] = account({ private_key: "SUPER-RAHASIA" });
    const status = pushConfigStatus();
    expect(JSON.stringify(status)).not.toContain("SUPER-RAHASIA");
    expect(JSON.stringify(status)).not.toContain("push@mcm-demo");
  });

  it("sendEach tidak menghubungi jaringan saat konfigurasi belum ada", async () => {
    delete process.env[KEY];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await sendEach([{ token: "t1", sound: true, vibrate: true, data: {} as never }]);
    expect(res.configured).toBe(false);
    expect(res.sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("menerima service account yang nama field & penanda PEM-nya ikut diterjemahkan", () => {
    process.env[KEY] = JSON.stringify({
      tipe: "akun_layanan",
      "ID proyek": "mcm-demo",
      email_klien: "push@mcm-demo.iam.gserviceaccount.com",
      kunci_pribadi: "-----MULAI KUNCI PRIVAT-----\nQUJD\n-----AKHIR KUNCI PRIVAT-----\n",
    });
    expect(pushConfigStatus()).toEqual({ configured: true });
  });
});
