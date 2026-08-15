import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Model registrasi perangkat: dedupe WAJIB memakai installation id yang stabil.
 * Token FCM berotasi, jadi `(user_id, push_token)` tidak boleh menjadi kunci.
 *
 * Tes ini mensimulasikan semantik `register_push_device` /
 * `revoke_my_push_installation` / `revoke_my_push_devices` di TypeScript,
 * lalu memverifikasi bentuk SQL migration agar keduanya tidak menyimpang.
 */

type Device = {
  id: number;
  user: string;
  installation: string;
  pushToken: string | null;
  revokedAt: number | null;
};

class DeviceTable {
  rows: Device[] = [];
  private seq = 1;

  /** Mirror dari public.register_push_device(_installation_id, ...). */
  register(user: string, installation: string, pushToken: string) {
    // Satu token FCM hanya boleh aktif pada satu baris.
    for (const r of this.rows) {
      if (r.pushToken === pushToken && !(r.user === user && r.installation === installation)) {
        r.pushToken = null;
        r.revokedAt = Date.now();
      }
    }
    const existing = this.rows.find((r) => r.user === user && r.installation === installation);
    if (existing) {
      existing.pushToken = pushToken;
      existing.revokedAt = null;
      return existing;
    }
    const row: Device = { id: this.seq++, user, installation, pushToken, revokedAt: null };
    this.rows.push(row);
    return row;
  }

  /** Mirror dari public.revoke_my_push_installation(_installation_id). */
  revokeInstallation(user: string, installation: string) {
    let n = 0;
    for (const r of this.rows) {
      if (r.user === user && r.installation === installation) {
        r.pushToken = null;
        r.revokedAt = Date.now();
        n++;
      }
    }
    return n;
  }

  /** Mirror dari public.revoke_my_push_devices(). */
  revokeAll(user: string) {
    let n = 0;
    for (const r of this.rows) {
      if (r.user === user && r.revokedAt === null) {
        r.pushToken = null;
        r.revokedAt = Date.now();
        n++;
      }
    }
    return n;
  }

  active(user: string) {
    return this.rows.filter((r) => r.user === user && r.pushToken !== null);
  }
}

describe("dedupe registrasi perangkat", () => {
  it("dua rotasi token pada instalasi sama tetap satu baris perangkat", () => {
    const t = new DeviceTable();
    t.register("u1", "inst-a", "fcm-1");
    t.register("u1", "inst-a", "fcm-2");
    t.register("u1", "inst-a", "fcm-3");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.pushToken).toBe("fcm-3");
    expect(t.active("u1")).toHaveLength(1);
  });

  it("instalasi berbeda pada akun sama menghasilkan baris berbeda", () => {
    const t = new DeviceTable();
    t.register("u1", "inst-a", "fcm-1");
    t.register("u1", "inst-b", "fcm-2");
    expect(t.rows).toHaveLength(2);
    expect(t.active("u1")).toHaveLength(2);
  });

  it("token FCM yang sama tidak boleh aktif pada dua instalasi", () => {
    const t = new DeviceTable();
    t.register("u1", "inst-a", "fcm-1");
    t.register("u1", "inst-b", "fcm-1");
    const withToken = t.rows.filter((r) => r.pushToken === "fcm-1");
    expect(withToken).toHaveLength(1);
    expect(withToken[0]!.installation).toBe("inst-b");
  });

  it("token FCM yang sama tidak boleh aktif pada dua pengguna", () => {
    const t = new DeviceTable();
    t.register("u1", "inst-a", "fcm-1");
    t.register("u2", "inst-a", "fcm-1");
    expect(t.active("u1")).toHaveLength(0);
    expect(t.active("u2")).toHaveLength(1);
  });

  it("logout instalasi saat ini tidak mencabut perangkat lain", () => {
    const t = new DeviceTable();
    t.register("u1", "inst-a", "fcm-1");
    t.register("u1", "inst-b", "fcm-2");
    expect(t.revokeInstallation("u1", "inst-a")).toBe(1);
    expect(t.active("u1").map((r) => r.installation)).toEqual(["inst-b"]);
  });

  it("keluar dari semua perangkat mencabut seluruh baris aktif akun", () => {
    const t = new DeviceTable();
    t.register("u1", "inst-a", "fcm-1");
    t.register("u1", "inst-b", "fcm-2");
    t.register("u2", "inst-c", "fcm-3");
    expect(t.revokeAll("u1")).toBe(2);
    expect(t.active("u1")).toHaveLength(0);
    expect(t.active("u2")).toHaveLength(1);
  });
});

const sql = readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.resolve(process.cwd(), "supabase/migrations", f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("bentuk SQL registrasi perangkat", () => {
  it("ada kolom + unique (user_id, installation_id)", () => {
    expect(sql).toContain("add column if not exists installation_id text");
    expect(sql).toMatch(
      /create unique index if not exists devices_user_installation_key on public\.devices \(user_id, installation_id\)/,
    );
  });

  it("register_push_device memakai installation id dan tidak menerbitkan action token", () => {
    const start = sql.lastIndexOf("create or replace function public.register_push_device");
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    expect(body).toContain("_installation_id");
    expect(body).toContain("on conflict (user_id, installation_id)");
    expect(body).not.toMatch(/'action_token'/);
    expect(body).not.toMatch(/gen_random_bytes/);
  });

  it("tersedia RPC pencabutan terpisah untuk instalasi saat ini", () => {
    expect(sql).toContain("create or replace function public.revoke_my_push_installation");
    expect(sql).toMatch(
      /grant execute on function public\.revoke_my_push_installation\(text\) to authenticated, service_role/,
    );
  });
});
