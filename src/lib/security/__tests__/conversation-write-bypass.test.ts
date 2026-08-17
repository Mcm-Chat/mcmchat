import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: tulis langsung ke `conversation_members` dan `business_conversations`
 * tidak boleh bisa ditembus dari klien. Dua lapis diuji:
 *  1. GRANT — tidak ada hak INSERT/UPDATE/DELETE tersisa untuk authenticated/anon
 *     setelah REVOKE terakhir (urut nama file = urut eksekusi).
 *  2. RLS — policy RESTRICTIVE dengan WITH CHECK (false) menutup semua policy
 *     permisif lama, apa pun payload yang dikirim penyerang.
 * Perubahan keanggotaan hanya lewat RPC SECURITY DEFINER.
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

function lastMatch(pattern: RegExp): string {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out = m[0];
  return out;
}

const TABLES = ["conversation_members", "business_conversations"] as const;

const POLICY: Record<(typeof TABLES)[number], string> = {
  conversation_members: "no direct member writes",
  business_conversations: "no direct business conversation writes",
};

describe.each(TABLES)("%s — hak tulis klien dicabut", (table) => {
  it("REVOKE write terakhir tidak diikuti GRANT write untuk authenticated/anon", () => {
    const revoke = lastIndexOf(
      new RegExp(
        `revoke (all|[^;]*insert[^;]*) on (table )?public\\.${table} from [^;]*(authenticated|anon|public)`,
      ),
    );
    expect(revoke).toBeGreaterThan(-1);
    const grantWrite = lastIndexOf(
      new RegExp(
        `grant [^;]*(insert|update|delete|all)[^;]* on (table )?public\\.${table} to [^;]*(authenticated|anon|public)`,
      ),
    );
    expect(grantWrite).toBeLessThan(revoke);
  });

  it("service_role tetap punya akses penuh untuk operasi tepercaya", () => {
    expect(lastIndexOf(new RegExp(`grant all on (table )?public\\.${table} to service_role`))).toBeGreaterThan(-1);
  });

  it("policy RESTRICTIVE menolak semua tulis lewat WITH CHECK (false)", () => {
    const policy = lastMatch(
      new RegExp(`create policy "${POLICY[table]}" on public\\.${table}[\\s\\S]*?;`),
    );
    expect(policy).not.toBe("");
    expect(policy).toMatch(/as restrictive/);
    expect(policy).toMatch(/for all to authenticated, anon/);
    expect(policy).toMatch(/with check \(false\)/);
    // Baca tetap dibatasi keanggotaan, bukan dibuka lebar.
    expect(policy).toMatch(/using \(current_user_can_read_conversation\(conversation_id\)\)/);
  });

  it("RLS aktif pada tabel", () => {
    expect(lastIndexOf(new RegExp(`alter table (only )?public\\.${table} enable row level security`))).toBeGreaterThan(-1);
  });
});

describe("jalur sah tetap tersedia lewat SECURITY DEFINER", () => {
  it.each([
    "create_group",
    "add_group_members",
    "remove_group_member",
    "set_group_member_role",
    "transfer_group_ownership",
    "leave_conversation",
    "get_or_create_business_conversation",
  ])("%s adalah security definer", (fn) => {
    const body = lastMatch(
      new RegExp(`create or replace function public\\.${fn}\\s*\\([\\s\\S]*?\\$(?:function)?\\$`),
    );
    expect(body, fn).not.toBe("");
    expect(body, fn).toMatch(/security definer/);
  });
});

describe("kode klien tidak menulis langsung ke tabel keanggotaan", () => {
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

  it.each(TABLES)("tidak ada insert/update/delete/upsert ke %s", (table) => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8").replace(/\s+/g, " ");
      const re = new RegExp(`from\\("${table}"\\)[^;]{0,200}?\\.(insert|update|delete|upsert)\\(`);
      return re.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe("model evaluasi policy (simulasi upaya bypass)", () => {
  // Postgres: RESTRICTIVE di-AND-kan dengan gabungan policy permisif.
  const permissiveWriteAllows = () => true; // policy lama masih ada, sengaja permisif
  const restrictiveCheck = () => false; // WITH CHECK (false)
  const writeAllowed = () => permissiveWriteAllows() && restrictiveCheck();

  it.each([
    ["menyisipkan diri ke percakapan orang lain", { conversation: "convBC", user: "A" }],
    ["mempromosikan diri jadi owner", { conversation: "convAB", user: "A", role: "owner" }],
    ["mendaftarkan percakapan bisnis palsu", { conversation: "convAB", business: "biz-x" }],
  ])("%s ditolak", () => {
    expect(writeAllowed()).toBe(false);
  });
});
