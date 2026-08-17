import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Bukti berbasis hasil query (bukan pembacaan teks migration): tidak ada jalur
 * GRANT/SELECT apa pun yang bisa mengembalikan kolom PIN untuk peran `anon`
 * maupun `authenticated` (anggota bisnis login). Satu-satunya jalur sah adalah
 * fungsi SECURITY DEFINER yang sudah bergerbang otorisasi.
 *
 * Tes ini butuh akses DB (PGHOST dkk). Di lingkungan tanpa DB, tes di-skip —
 * invarian bentuk skema tetap dijaga oleh db-security-invariants &
 * customer-pin-acl (analisis statis migration).
 */

const HAS_DB = Boolean(process.env["PGHOST"]);
const d = HAS_DB ? describe : describe.skip;

function q(sql: string): string[] {
  const out = execFileSync("psql", ["-At", "-c", sql], { encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Kolom apa pun yang bernama/berakhiran pin dan menyimpan rahasia. */
const SECRET_PIN_COLUMNS = ["pin", "staff_pin"];

/**
 * Fungsi yang boleh menyentuh PIN dan dapat dipanggil peran login.
 * Trigger/helper internal (tanpa EXECUTE untuk `authenticated`) tidak termasuk
 * karena bukan jalur baca yang bisa dipanggil klien.
 */
const ALLOWED_PIN_FUNCTIONS = [
  "business_staff_directory",
  "confirm_staff_pin",
  "customer_pin",
  "deliver_preparation_job",
  "my_pin",
  "pins_for_me",
  "profile_full",
  "search_profile_by_pin",
  "find_profile_by_pin",
];

d("kolom PIN — hak akses hasil query", () => {
  const cols = SECRET_PIN_COLUMNS.map((c) => `'${c}'`).join(",");

  it("tidak ada relasi public dengan kolom PIN yang ter-SELECT oleh anon/authenticated", () => {
    const rows = q(`
      select r.rolname || ' ' || c.relname || '.' || a.attname
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_roles r on r.rolname in ('anon','authenticated')
      where c.relnamespace = 'public'::regnamespace
        and a.attname in (${cols})
        and has_column_privilege(r.rolname, c.oid, a.attname, 'SELECT')
    `);
    expect(rows).toEqual([]);
  });

  it("kolom PIN memang masih ada (tes tidak lulus karena kolomnya hilang)", () => {
    const rows = q(`
      select c.relname || '.' || a.attname
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r','p')
        and a.attname in (${cols})
    `);
    expect(rows).toContain("profiles.pin");
    expect(rows).toContain("customers.pin");
    expect(rows).toContain("business_members.staff_pin");
  });

  it("tidak ada privilege tabel-penuh (tanpa daftar kolom) pada tabel pemilik PIN", () => {
    const rows = q(`
      select r.rolname || ' ' || c.relname
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname in (${cols})
      join pg_roles r on r.rolname in ('anon','authenticated')
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r','p')
        and has_table_privilege(r.rolname, c.oid, 'SELECT')
    `);
    // has_table_privilege true hanya bila SELECT diberikan untuk seluruh kolom.
    expect(rows).toEqual([]);
  });
});

d("view / matview — tidak ada jalur pintas ke PIN", () => {
  it("tidak ada view atau matview public yang mengekspos kolom PIN", () => {
    const cols = SECRET_PIN_COLUMNS.map((c) => `'${c}'`).join(",");
    const rows = q(`
      select c.relname || '.' || a.attname
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('v','m')
        and a.attname in (${cols})
    `);
    expect(rows).toEqual([]);
  });

  it("tidak ada view public yang definisinya membaca kolom PIN tabel rahasia", () => {
    const rows = q(`
      select viewname from pg_views
      where schemaname = 'public'
        and (definition ilike '%.pin%' or definition ilike '%staff_pin%')
    `);
    expect(rows).toEqual([]);
  });
});

d("fungsi — satu-satunya jalur PIN, dan tetap tertutup untuk anon", () => {
  const rows = q(`
    select p.proname || '|' || p.prosecdef::text || '|'
           || has_function_privilege('anon', p.oid, 'EXECUTE')::text
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and (p.prosrc ilike '%.pin%' or p.prosrc ilike '%staff_pin%'
           or p.prosrc ilike '% pin %' or p.prosrc ilike '%pin =%')
  `).map((r) => {
    const [name, secdef, anon] = r.split("|");
    return { name: name ?? "", secdef: secdef === "t", anon: anon === "t" };
  });

  it("setiap fungsi yang menyentuh PIN ada di allowlist", () => {
    const unexpected = rows.map((r) => r.name).filter((n) => !ALLOWED_PIN_FUNCTIONS.includes(n));
    expect(unexpected).toEqual([]);
  });

  it("semuanya SECURITY DEFINER dan tidak dapat dieksekusi anon", () => {
    for (const r of rows) {
      expect(r.secdef, `${r.name} harus SECURITY DEFINER`).toBe(true);
      expect(r.anon, `${r.name} tidak boleh executable oleh anon`).toBe(false);
    }
  });

  it("customer_pin tetap bergerbang can_manage_business", () => {
    const src = q(`
      select replace(p.prosrc, E'\\n', ' ')
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'customer_pin'
    `).join(" ");
    expect(src).toMatch(/can_manage_business/);
    expect(src).toMatch(/auth\.uid\(\)/);
  });
});
