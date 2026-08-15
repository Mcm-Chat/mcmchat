import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard ACL/RLS untuk tabel unit fisik + pesanan chat.
 * Migration dibaca urut nama file (= urut eksekusi), statement terakhir menang.
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

function lastIndex(pattern: RegExp): number {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) idx = m.index;
  return idx;
}

const TABLES = ["variant_stock_units", "chat_orders", "chat_order_items", "chat_order_unit_slots"];

describe("ACL tabel unit & pesanan chat", () => {
  for (const table of TABLES) {
    it(`${table}: revoke all dari anon/authenticated/public setelah grant terakhir yang longgar`, () => {
      const revoke = lastIndex(
        new RegExp(`revoke all on table public\\.${table} from anon, authenticated, public`),
      );
      expect(revoke).toBeGreaterThan(-1);
      const looseGrant = lastIndex(
        new RegExp(
          `grant [^;]*(insert|update|delete|truncate|all)[^;]*on [^;]*public\\.${table}[^;]*to [^;]*(anon|authenticated)`,
        ),
      );
      expect(looseGrant).toBeLessThan(revoke);
    });

    it(`${table}: authenticated hanya diberi select`, () => {
      const revoke = lastIndex(
        new RegExp(`revoke all on table public\\.${table} from anon, authenticated, public`),
      );
      const grant = lastIndex(new RegExp(`grant select on public\\.${table} to authenticated`));
      expect(grant).toBeGreaterThan(revoke);
      expect(lastIndex(new RegExp(`grant [^;]*on public\\.${table} to [^;]*anon`))).toBeLessThan(
        revoke,
      );
    });
  }
});

describe("policy hanya memakai helper self-scoped", () => {
  const ARBITRARY = [
    "is_business_member",
    "can_manage_business",
    "can_sell_business",
    "is_conv_member",
  ];

  it("policy tabel baru tidak memanggil helper arbitrary-user", () => {
    const policies = sql.match(/create policy [^;]*;/g) ?? [];
    // Hanya definisi TERAKHIR per (tabel, nama policy) yang berlaku di database.
    const latest = new Map<string, string>();
    for (const p of policies) {
      const table = TABLES.find((t) => p.includes(`public.${t}`));
      if (!table) continue;
      const name = p.match(/create policy "([^"]+)"/)?.[1] ?? p.slice(0, 60);
      latest.set(`${table}|${name}`, p);
    }
    expect(latest.size).toBeGreaterThan(0);
    for (const p of latest.values()) {
      for (const helper of ARBITRARY) {
        // helper self-scoped (current_user_*) diperbolehkan
        const bare = new RegExp(`(?<!current_user_)\\b${helper}\\s*\\(`);
        expect(bare.test(p), `${helper} dipakai di policy: ${p.slice(0, 120)}`).toBe(false);
      }
      expect(p).not.toMatch(/,\s*auth\.uid\(\)\s*\)/);
    }
  });
});

describe("helper function ACL", () => {
  it("current_user_can_read_chat_order self-scoped, definer, search_path terkunci", () => {
    expect(sql).toMatch(
      /create or replace function public\.current_user_can_read_chat_order\(\s*_order uuid\s*\)[\s\S]*?security definer/,
    );
    const def = sql.slice(
      lastIndex(/create or replace function public\.current_user_can_read_chat_order/),
    );
    expect(def.slice(0, 1200)).toMatch(/set search_path (?:=|to) '?public'?/);
    expect(def.slice(0, 1200)).toMatch(/auth\.uid\(\)/);
    expect(
      lastIndex(
        /grant execute on function public\.current_user_can_read_chat_order\(uuid\) to authenticated, service_role/,
      ),
    ).toBeGreaterThan(
      lastIndex(
        /revoke execute on function public\.current_user_can_read_chat_order\(uuid\) from public, anon/,
      ),
    );
  });

  it("helper arbitrary-user is_business_member tidak executable oleh anon/authenticated", () => {
    const revoke = lastIndex(
      /revoke execute on function public\.is_business_member\(uuid, uuid\) from public, anon, authenticated/,
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(
      lastIndex(
        /grant execute on function public\.is_business_member\(uuid, uuid\) to [^;]*authenticated/,
      ),
    ).toBeLessThan(revoke);
  });
});
