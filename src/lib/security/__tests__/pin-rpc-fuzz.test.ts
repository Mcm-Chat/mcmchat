import fc from "fast-check";
import { describe, expect, it } from "vitest";

/**
 * Fuzz / property-based: untuk SEMUA RPC dan endpoint yang bersentuhan dengan
 * PIN, akses ditolak bagi peran `anon` dan bagi anggota bisnis yang tidak punya
 * izin — apa pun bentuk argumen, casing kolom, filter, order, atau embed yang
 * dicoba. Properti yang diuji, untuk setiap input acak:
 *   1) respons TIDAK PERNAH memuat field PIN (atau variannya), dan
 *   2) jalur baca kolom PIN selalu ditolak (4xx), bukan mengembalikan data.
 *
 * Tanpa kredensial Data API tes di-skip; di CI PIN_GATE_STRICT=1 memaksa gagal.
 */

const URL_BASE = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_ANON_KEY"] ??
  "";
const USER_TOKEN = process.env["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"] ?? "";

const HAS_API = Boolean(URL_BASE && ANON);
const STRICT = process.env["PIN_GATE_STRICT"] === "1";
const d = HAS_API ? describe : describe.skip;

describe("gate fuzz PIN wajib aktif di CI", () => {
  it("kredensial Data API tersedia saat PIN_GATE_STRICT=1", () => {
    expect(
      HAS_API || !STRICT,
      "PIN_GATE_STRICT=1 tetapi kredensial Data API tidak diset: fuzz PIN tidak dieksekusi",
    ).toBe(true);
  });
});

const PIN_KEY = /(^|_)pins?$|(^|_)pin_?(code|hash)$/;

function isPinKey(key: string): boolean {
  return PIN_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
}

function pinKeysIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => pinKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      isPinKey(k) ? [`${path}.${k}`] : pinKeysIn(v, `${path}.${k}`),
    );
  }
  return [];
}

type Caller = "anon" | "member";
const CALLERS: Caller[] = USER_TOKEN ? ["anon", "member"] : ["anon"];

async function api(caller: Caller, path: string, init?: RequestInit) {
  const token = caller === "member" ? USER_TOKEN : ANON;
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Endpoint tabel yang memiliki kolom PIN. */
const PIN_TABLES: Array<{ table: string; column: string }> = [
  { table: "customers", column: "pin" },
  { table: "profiles", column: "pin" },
  { table: "business_members", column: "staff_pin" },
  { table: "preparation_jobs", column: "delivered_pin" },
  { table: "pin_search_log", column: "pin" },
];

/** RPC yang bersentuhan dengan PIN beserta pembuat argumen acak. */
const PIN_RPCS: Array<{ name: string; args: () => fc.Arbitrary<Record<string, unknown>> }> = [
  { name: "my_pin", args: () => fc.constant({}) },
  { name: "pins_for_me", args: () => fc.constant({}) },
  { name: "gen_mcm_pin", args: () => fc.constant({}) },
  { name: "customer_pin", args: () => fc.record({ _customer: fuzzId() }) },
  { name: "search_profile_by_pin", args: () => fc.record({ _pin: fuzzPin() }) },
  {
    name: "confirm_staff_pin",
    args: () => fc.record({ _business: fuzzId(), _pin: fuzzPin(), _label: fuzzText() }),
  },
  { name: "profile_full", args: () => fc.record({ _id: fuzzId() }) },
  { name: "business_staff_directory", args: () => fc.record({ _business: fuzzId() }) },
];

function fuzzId(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.uuid(),
    fc.constant("00000000-0000-0000-0000-000000000000"),
    fc.string({ minLength: 0, maxLength: 40 }),
    fc.constant("' OR 1=1 --"),
  );
}

function fuzzPin(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.stringMatching(/^[0-9]{4,8}$/),
    fc.constant("%"),
    fc.constant("*"),
    fc.constant("' OR '1'='1"),
    fc.string({ maxLength: 30 }),
  );
}

function fuzzText(): fc.Arbitrary<string> {
  return fc.string({ maxLength: 20 });
}

/** Variasi penulisan kolom PIN yang mungkin dicoba penyerang. */
function pinColumnVariants(column: string): fc.Arbitrary<string> {
  return fc.constantFrom(
    column,
    column.toUpperCase(),
    `"${column}"`,
    `alias:${column}`,
    `${column}::text`,
    `id,${column}`,
    `*,${column}`,
  );
}

const RUNS = Number(process.env["PIN_FUZZ_RUNS"] ?? 12);
const cfg: fc.Parameters = { numRuns: RUNS, verbose: false };

d("fuzz: RPC bersentuhan PIN menolak anon/anggota tanpa izin", () => {
  for (const caller of CALLERS) {
    for (const rpc of PIN_RPCS) {
      it(
        `${rpc.name} tidak pernah membocorkan PIN untuk ${caller}`,
        async () => {
          await fc.assert(
            fc.asyncProperty(rpc.args(), async (args) => {
              const res = await api(caller, `rpc/${rpc.name}`, {
                method: "POST",
                body: JSON.stringify(args),
              });
              const leaks = pinKeysIn(res.body);
              expect(leaks, `${rpc.name}(${JSON.stringify(args)}) bocor: ${leaks.join(",")}`).toEqual(
                [],
              );
              if (caller === "anon") {
                // anon tidak boleh sukses pada RPC bergerbang otorisasi
                expect(
                  res.status >= 400,
                  `${rpc.name} justru mengizinkan anon (status ${res.status})`,
                ).toBe(true);
              }
              return true;
            }),
            cfg,
          );
        },
        120_000,
      );
    }
  }
});

d("fuzz: endpoint tabel menolak seleksi kolom PIN", () => {
  for (const caller of CALLERS) {
    for (const { table, column } of PIN_TABLES) {
      it(
        `${table}.${column} tidak terbaca lewat select acak (${caller})`,
        async () => {
          await fc.assert(
            fc.asyncProperty(pinColumnVariants(column), async (sel) => {
              const res = await api(caller, `${table}?select=${encodeURIComponent(sel)}&limit=3`);
              const leaks = pinKeysIn(res.body);
              expect(leaks, `${table}?select=${sel} bocor: ${leaks.join(",")}`).toEqual([]);
              return true;
            }),
            cfg,
          );
        },
        120_000,
      );

      it(
        `${table}.${column} tidak bisa dijadikan oracle lewat filter/order acak (${caller})`,
        async () => {
          await fc.assert(
            fc.asyncProperty(
              fc.constantFrom("eq", "like", "ilike", "gt", "lt", "neq"),
              fuzzPin(),
              fc.constantFrom("asc", "desc"),
              async (op, val, dir) => {
                const res = await api(
                  caller,
                  `${table}?select=id&${column}=${op}.${encodeURIComponent(val)}&order=${column}.${dir}&limit=3`,
                );
                const leaks = pinKeysIn(res.body);
                expect(leaks, `${table} filter ${column}=${op}.${val} bocor`).toEqual([]);
                expect(
                  res.status >= 400 || (Array.isArray(res.body) && res.body.length === 0),
                  `${table} mengizinkan filter pada ${column} (status ${res.status})`,
                ).toBe(true);
                return true;
              },
            ),
            cfg,
          );
        },
        120_000,
      );
    }
  }
});
