import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard untuk empat area keamanan yang pernah bocor:
 *  1. Akses PIN (profiles + customers)
 *  2. Izin baca bucket avatars
 *  3. Jalur hapus anggota percakapan oleh admin
 *  4. Pengecekan keanggotaan percakapan
 *
 * Tes ini membaca seluruh migration (urut nama file = urut eksekusi) dan
 * memastikan bentuk akhir skema tetap aman. Jika seseorang menambah migration
 * yang melonggarkan grant/policy tersebut, tes ini gagal.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

function loadMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files
    .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const sql = loadMigrations();

/** Statement terakhir yang cocok menang, seperti urutan eksekusi Postgres. */
function lastIndexOfPattern(pattern: RegExp): number {
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) idx = m.index;
  return idx;
}

function has(pattern: RegExp): boolean {
  return lastIndexOfPattern(pattern) !== -1;
}

describe("akses PIN", () => {
  it("kolom profiles.pin tidak masuk grant tabel untuk authenticated", () => {
    expect(has(/revoke select on public\.profiles from authenticated/)).toBe(true);
    const grant = sql.match(/grant select \(([^)]*)\) on public\.profiles to authenticated/g) ?? [];
    expect(grant.length).toBeGreaterThan(0);
    for (const g of grant) expect(g).not.toMatch(/\bpin\b/);
  });

  it("tidak ada grant select penuh pada profiles ke anon/authenticated setelah pencabutan", () => {
    const revoke = lastIndexOfPattern(/revoke select on public\.profiles from authenticated/);
    const fullGrant = lastIndexOfPattern(
      /grant select on public\.profiles to (anon|authenticated)/,
    );
    expect(fullGrant).toBeLessThan(revoke);
  });

  it("PIN hanya dibaca lewat RPC security definer yang dibatasi", () => {
    for (const fn of [/my_pin\(\)/, /pins_for_me\(uuid\[\]\)/, /find_profile_by_pin\(text\)/]) {
      expect(
        has(new RegExp(`revoke (all|execute) on function public\\.${fn.source} from [^;]*`)),
      ).toBe(true);
      expect(
        has(new RegExp(`grant execute on function public\\.${fn.source} to authenticated`)),
      ).toBe(true);
      expect(
        has(new RegExp(`grant execute on function public\\.${fn.source} to (anon|public)`)),
      ).toBe(false);
    }
  });

  it("customers.pin dicabut dan hanya lewat customer_pin() untuk pengelola bisnis", () => {
    expect(has(/revoke select \(pin\) on public\.customers from authenticated/)).toBe(true);
    expect(has(/revoke select \(pin\) on public\.customers from anon/)).toBe(true);
    expect(has(/create or replace function public\.customer_pin\(_customer uuid\)/)).toBe(true);
    expect(
      has(/customer_pin[\s\S]{0,400}?can_manage_business\(c\.business_id, auth\.uid\(\)\)/),
    ).toBe(true);
    expect(has(/grant execute on function public\.customer_pin\(uuid\) to anon/)).toBe(false);
  });
});

describe("izin bucket avatars", () => {
  it("policy baca avatars memakai can_read_avatar_object dan hanya untuk authenticated", () => {
    expect(
      has(
        /create policy "avatar read" on storage\.objects for select to authenticated using \(bucket_id = 'avatars' and public\.can_read_avatar_object\(name\)\)/,
      ),
    ).toBe(true);
  });

  it("tidak ada policy avatars yang terbuka untuk anon/public setelah pengetatan", () => {
    const scoped = lastIndexOfPattern(/create policy "avatar read" on storage\.objects/);
    const open = lastIndexOfPattern(
      /bucket_id = 'avatars'[^;]{0,200}(to anon|to public|using \(true\))/,
    );
    expect(open).toBeLessThan(scoped);
  });

  it("bucket avatars tidak dibuat/diubah menjadi public", () => {
    const publicAvatar = sql.match(/insert into storage\.buckets[^;]*'avatars'[^;]*/g) ?? [];
    for (const stmt of publicAvatar) expect(stmt).not.toMatch(/,\s*true/);
    expect(has(/update storage\.buckets set public = true where id = 'avatars'/)).toBe(false);
  });

  it("can_read_avatar_object membatasi ke pemilik, kontak, dan lawan percakapan", () => {
    const fn = sql.slice(
      lastIndexOfPattern(/create or replace function public\.can_read_avatar_object\(_name text\)/),
    );
    expect(fn).toMatch(/auth\.uid\(\) is not null/);
    // Objek avatar selalu berada di folder <owner_id>/..., dan keputusan akses
    // didelegasikan ke can_view_avatar (pemilik, kontak, percakapan, privasi, blokir).
    expect(fn).toMatch(/storage\.foldername\(_name\)\)\[1\]/);
    expect(fn).toMatch(/public\.can_view_avatar\(/);
    expect(has(/grant execute on function public\.can_read_avatar_object\(text\) to anon/)).toBe(
      false,
    );
  });

  it("can_view_avatar menghormati privasi avatar dan blokir", () => {
    const fn = sql.slice(
      lastIndexOfPattern(/create or replace function public\.can_view_avatar\(/),
    );
    expect(fn).toMatch(/avatar_privacy/);
    expect(fn).toMatch(/is_blocked = true/);
    expect(fn).toMatch(/public\.contacts/);
    expect(has(/grant execute on function public\.can_view_avatar\(uuid, uuid\) to anon/)).toBe(
      false,
    );
  });
});

describe("hapus anggota percakapan (jalur admin)", () => {
  it("ada policy delete untuk admin/pembuat percakapan", () => {
    expect(
      has(
        /create policy "admin removes members" on public\.conversation_members for delete to authenticated using \(public\.is_conv_admin\(conversation_id, auth\.uid\(\)\)\)/,
      ),
    ).toBe(true);
  });

  it("is_conv_admin hanya mengakui pembuat percakapan atau role admin/owner", () => {
    const fn = sql.slice(
      lastIndexOfPattern(
        /create or replace function public\.is_conv_admin\(_conv uuid, _uid uuid\)/,
      ),
    );
    expect(fn).toMatch(/c\.created_by = _uid/);
    expect(fn).toMatch(/m\.role in \('admin','owner'\)/);
    expect(fn.slice(0, 400)).toMatch(/security definer/);
  });

  it("policy delete tidak pernah dibuat tanpa pengecekan admin", () => {
    const deletes =
      sql.match(/create policy "[^"]*" on public\.conversation_members for delete[^;]*/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const p of deletes) {
      expect(p).toMatch(/to authenticated/);
      expect(p).toMatch(/is_conv_admin|user_id = auth\.uid\(\)/);
      expect(p).not.toMatch(/using \(true\)/);
    }
  });
});

describe("pengecekan keanggotaan percakapan", () => {
  it("is_conv_member tetap security definer dan tidak bisa dipanggil anon", () => {
    const fn = sql.slice(
      lastIndexOfPattern(
        /create or replace function public\.is_conv_member\(_conv uuid, _uid uuid\)/,
      ),
    );
    expect(fn.slice(0, 400)).toMatch(/security definer/);
    expect(has(/revoke all on function public\.is_conv_member\(uuid, uuid\) from anon/)).toBe(true);
    expect(has(/grant execute on function public\.is_conv_member\(uuid, uuid\) to anon/)).toBe(
      false,
    );
  });

  it("policy pesan/anggota selalu bersandar pada keanggotaan, bukan true", () => {
    const policies =
      sql.match(
        /create policy "[^"]*" on public\.(messages|conversation_members|conversations)[^;]*/g,
      ) ?? [];
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      expect(p).not.toMatch(/using \(true\)/);
      expect(p).not.toMatch(/\bto anon\b/);
    }
  });

  it("helper internal bisnis tidak dapat dieksekusi klien", () => {
    expect(
      has(
        /revoke all on function public\.business_role_of\(uuid, uuid\) from public, anon, authenticated/,
      ),
    ).toBe(true);
    expect(has(/revoke all on function public\.can_manage_business\(uuid, uuid\) from anon/)).toBe(
      true,
    );
  });

  it("staff_pin tidak pernah masuk grant select tabel business_members", () => {
    // Grant SELECT tingkat tabel membatalkan REVOKE kolom, jadi bentuk akhir
    // wajib berupa grant kolom eksplisit tanpa staff_pin.
    expect(has(/revoke select on public\.business_members from authenticated/)).toBe(true);
    expect(has(/revoke all on public\.business_members from anon/)).toBe(true);

    // Bentuk akhir yang menentukan: setiap grant SELECT seluruh tabel harus
    // sudah dibatalkan oleh REVOKE, dan grant kolom datang setelahnya.
    const revokeAt = sql.search(/revoke select on public\.business_members from authenticated/);
    const columnGrantAt = sql.search(
      /grant select\s*\([^)]*\)\s*on public\.business_members to authenticated/,
    );
    expect(columnGrantAt).toBeGreaterThan(revokeAt);

    const grants = sql.match(/grant select[^;]*on public\.business_members to \w+/g) ?? [];
    for (const g of grants) {
      expect(g).not.toMatch(/to anon/);
      const at = sql.indexOf(g);
      // grant seluruh tabel hanya boleh ada sebelum REVOKE
      if (!/grant select\s*\(/.test(g)) expect(at).toBeLessThan(revokeAt);
      else expect(g).not.toMatch(/\bstaff_pin\b(?!_confirmed_at)/);
    }
  });
});

describe("kode klien tidak membaca kolom PIN langsung", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  }

  it("tidak ada select('pin') / select('*') pada profiles atau customers", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(process.cwd(), "src"))) {
      const src = readFileSync(file, "utf8");
      const calls =
        src.match(/from\(\s*["'](profiles|customers)["']\s*\)[\s\S]{0,200}?select\(([^)]*)\)/g) ??
        [];
      for (const c of calls) {
        if (/\bpin\b/.test(c) || /select\(\s*["']\*["']\s*\)/.test(c))
          offenders.push(`${file}: ${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tidak ada select('*') pada business_members", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(process.cwd(), "src"))) {
      if (file.includes("integrations/supabase")) continue;
      const src = readFileSync(file, "utf8");
      const calls =
        src.match(/from\(\s*["']business_members["']\s*\)[\s\S]{0,200}?select\(([^)]*)\)/g) ?? [];
      for (const c of calls) {
        if (/select\(\s*["']\*["']\s*\)/.test(c) || /\bstaff_pin\b(?!_confirmed_at)/.test(c)) {
          offenders.push(`${file}: ${c}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
