import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard ACL perangkat.
 *
 * `devices`, `background_action_log`, dan `device_action_rate` tidak boleh
 * memiliki privilege tabel untuk `anon`/`authenticated`. RLS saja tidak cukup:
 * TRUNCATE tidak dilindungi RLS, dan grant UPDATE pada `devices` akan
 * membatalkan keamanan kredensial aksi (push_token / action_token_hash).
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const SRC_DIR = path.resolve(process.cwd(), "src");

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({
      name: f,
      sql: readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")
        .replace(/--[^\n]*/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase(),
    }));
}

const files = migrationFiles();
const sql = files.map((f) => f.sql).join("\n");

function lastIndexOfPattern(pattern: RegExp): number {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) idx = m.index;
  return idx;
}

const TABLES = ["devices", "background_action_log", "device_action_rate"] as const;

describe("ACL tabel perangkat", () => {
  for (const table of TABLES) {
    it(`${table}: revoke all dari anon/authenticated adalah statement grant terakhir`, () => {
      const revoke = lastIndexOfPattern(
        new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`),
      );
      expect(revoke).toBeGreaterThan(-1);
      const clientGrant = lastIndexOfPattern(
        new RegExp(`grant [^;]*on public\\.${table}[^;]*to [^;]*(anon|authenticated)`),
      );
      expect(clientGrant).toBeLessThan(revoke);
    });
  }

  it("policy FOR ALL pada devices sudah dihapus", () => {
    const drop = lastIndexOfPattern(/drop policy if exists "own devices" on public\.devices/);
    const create = lastIndexOfPattern(/create policy "own devices" on public\.devices/);
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeLessThan(drop);
  });

  it("RPC perangkat tidak pernah membocorkan token atau sidik jari kredensial", () => {
    const start = lastIndexOfPattern(/create or replace function public\.my_push_devices/);
    expect(start).toBeGreaterThan(-1);
    const fn = sql.slice(start, sql.indexOf("$$;", start));
    expect(fn).not.toMatch(/action_token_hash|action_token_prefix/);
    expect(fn).not.toMatch(/select[^;]*\bd\.push_token\b(?!\s+is)/);
    expect(fn).toMatch(/set search_path to 'public'/);
  });

  it("RPC perangkat dicabut dari anon dan hanya diberikan ke authenticated/service_role", () => {
    for (const fn of ["my_push_devices\\(\\)", "revoke_my_push_device\\(uuid\\)"]) {
      expect(
        lastIndexOfPattern(new RegExp(`revoke all on function public\\.${fn} from public, anon`)),
      ).toBeGreaterThan(-1);
      expect(
        lastIndexOfPattern(
          new RegExp(`grant execute on function public\\.${fn} to authenticated, service_role`),
        ),
      ).toBeGreaterThan(-1);
    }
  });

  it("helper laju aksi latar hanya untuk service_role", () => {
    expect(
      lastIndexOfPattern(
        /revoke all on function public\.bg_rate_ok\(uuid, text, integer\) from public, anon, authenticated/,
      ),
    ).toBeGreaterThan(-1);
  });

  it("kode klien tidak menyentuh tabel perangkat/log secara langsung", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        // File server-only (admin) boleh; klien tidak.
        if (/\.server\.ts$/.test(entry.name)) continue;
        if (full.includes(`${path.sep}__tests__${path.sep}`)) continue;
        const text = readFileSync(full, "utf8");
        if (/from\(["'](devices|background_action_log|device_action_rate)["']\)/.test(text)) {
          offenders.push(path.relative(SRC_DIR, full));
        }
      }
    };
    walk(SRC_DIR);
    expect(offenders).toEqual([]);
  });
});
