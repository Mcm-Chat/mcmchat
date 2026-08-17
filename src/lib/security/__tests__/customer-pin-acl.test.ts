import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PIN pelanggan: rahasia pemilik/admin bisnis.
 *
 * Invarian end-to-end yang dijaga di sini:
 *  1. DB — kolom `customers.pin` tidak ter-grant ke authenticated/anon, dan
 *     seluruh akses anon ke tabel dicabut.
 *  2. RPC — `customer_pin()` SECURITY DEFINER, menuntut auth.uid() dan
 *     `can_manage_business`, tidak dapat dieksekusi anon/PUBLIC.
 *  3. Klien — tidak ada `select("*")` atau pembacaan kolom `pin` langsung dari
 *     tabel `customers`; satu-satunya jalur adalah RPC.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const SRC = path.resolve(process.cwd(), "src");

const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

function lastIndexOf(pattern: RegExp): number {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) idx = m.index;
  return idx;
}

function lastFunctionBody(name: string): string {
  const re = new RegExp(
    `create or replace function public\\.${name}\\s*\\([^;]*?\\$(?:function)?\\$(.*?)\\$(?:function)?\\$`,
    "gs",
  );
  let body = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1] ?? "";
  return body;
}

describe("customers.pin — grant tabel", () => {
  it("kolom pin dicabut dari authenticated dan anon", () => {
    const revoke = lastIndexOf(/revoke select \(pin\) on public\.customers from [^;]*authenticated/);
    expect(revoke).toBeGreaterThan(-1);
    const grantPin = lastIndexOf(/grant [^;]*\([^)]*\bpin\b[^)]*\) on public\.customers to/);
    expect(grantPin).toBeLessThan(revoke);
  });

  it("anon tidak punya akses apa pun ke tabel customers", () => {
    const revokeAnon = lastIndexOf(/revoke all on (table )?public\.customers from [^;]*anon/);
    expect(revokeAnon).toBeGreaterThan(-1);
    expect(lastIndexOf(/grant [^;]* on (table )?public\.customers to [^;]*anon/)).toBeLessThan(
      revokeAnon,
    );
  });

  it("grant kolom untuk authenticated bersifat allowlist tanpa pin", () => {
    const grant = lastIndexOf(
      /grant select \(id, business_id, user_id, name, address, note, created_at, updated_at\) on public\.customers to authenticated/,
    );
    expect(grant).toBeGreaterThan(-1);
  });
});

describe("customer_pin() — gerbang otorisasi", () => {
  const body = lastFunctionBody("customer_pin");

  it("security definer dengan search_path terkunci", () => {
    expect(
      lastIndexOf(
        /create or replace function public\.customer_pin\(_customer uuid\)[\s\S]*?security definer/,
      ),
    ).toBeGreaterThan(-1);
    expect(
      lastIndexOf(
        /create or replace function public\.customer_pin\(_customer uuid\)[\s\S]*?set search_path to 'public'/,
      ),
    ).toBeGreaterThan(-1);
  });

  it("menolak anonim dan bukan pengelola bisnis", () => {
    expect(body).toMatch(/auth\.uid\(\) is not null/);
    expect(body).toMatch(/can_manage_business\(c\.business_id, auth\.uid\(\)\)/);
    expect(body).toMatch(/where c\.id = _customer/);
  });

  it("execute hanya untuk authenticated, tidak untuk anon/PUBLIC", () => {
    const grant = lastIndexOf(
      /grant execute on function public\.customer_pin\(uuid\) to authenticated/,
    );
    expect(grant).toBeGreaterThan(-1);
    expect(
      lastIndexOf(/grant execute on function public\.customer_pin\(uuid\) to [^;]*(anon|public)/),
    ).toBeLessThan(lastIndexOf(/revoke all on function public\.customer_pin\(uuid\) from [^;]*/));
  });
});

describe("klien — tidak ada jalur baca PIN selain RPC", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const files = walk(SRC).filter(
    (f) => !f.includes("__tests__") && !f.includes(path.join("integrations", "supabase")),
  );
  const reads = files
    .map((f) => ({ f, src: readFileSync(f, "utf8").replace(/\s+/g, " ") }))
    .filter(({ src }) => src.includes('from("customers")'));

  it("setiap select pada customers memakai allowlist kolom", () => {
    for (const { f, src } of reads) {
      const selects = src.match(/from\("customers"\)\s*\.select\(([^)]*)\)/g) ?? [];
      for (const s of selects) {
        expect(s, f).not.toMatch(/select\("\*"\)/);
        expect(s, f).toMatch(/CUSTOMER_SAFE_COLUMNS/);
      }
    }
  });

  it("tidak ada kode yang meminta kolom pin dari tabel customers", () => {
    for (const { f, src } of reads) {
      expect(src, f).not.toMatch(/from\("customers"\)[^;]{0,200}\bpin\b/);
    }
  });

  it("allowlist kolom pada helper klien tidak memuat pin", () => {
    const helper = readFileSync(path.join(SRC, "lib/api/customers.ts"), "utf8");
    const list = /CUSTOMER_SAFE_COLUMNS\s*=\s*"([^"]+)"/.exec(helper)?.[1] ?? "";
    expect(list).not.toBe("");
    expect(list.split(",").map((c) => c.trim())).not.toContain("pin");
    expect(helper).toMatch(/supabase\.rpc\("customer_pin"/);
  });
});
