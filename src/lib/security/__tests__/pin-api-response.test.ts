import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { recordPinFinding, writePinReport } from "./helpers/pin-report";

/**
 * Tes tingkat API (bukan analisis skema): memanggil endpoint Data API sungguhan
 * sebagai `anon` dan sebagai pengguna login (anggota bisnis), lalu membuktikan
 * tidak ada respons — termasuk payload hasil join/embed, chat, dan ledger —
 * yang pernah menyertakan field `pin` atau variasinya.
 *
 * Di lingkungan tanpa kredensial/jaringan, tes di-skip; invarian bentuknya
 * tetap dijaga oleh pin-grant-live & customer-pin-acl.
 */

const URL_BASE = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_ANON_KEY"] ??
  "";
const USER_TOKEN = process.env["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"] ?? "";

const HAS_API = Boolean(URL_BASE && ANON);
/** Di CI (PIN_GATE_STRICT=1) tes API ini WAJIB jalan; skip diperlakukan sebagai gagal. */
const STRICT = process.env["PIN_GATE_STRICT"] === "1";
const d = HAS_API ? describe : describe.skip;

describe("gate API PIN wajib aktif di CI", () => {
  it("kredensial Data API tersedia saat PIN_GATE_STRICT=1", () => {
    expect(
      HAS_API || !STRICT,
      "PIN_GATE_STRICT=1 tetapi SUPABASE_URL/PUBLISHABLE_KEY tidak diset: gate respons API PIN tidak dieksekusi",
    ).toBe(true);
  });
});

/**
 * Rahasia PIN: `pin`, `staff_pin`, `delivered_pin`, `pinCode`, `pin_hash`.
 * Bukan rahasia: `pinned_at`, `is_pinned`, `pin_confirmed_at` (metadata waktu).
 */
const PIN_KEY = /(^|_)pins?$|(^|_)pin_?(code|hash)$/;

function isPinKey(key: string): boolean {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return PIN_KEY.test(snake);
}

/** Kumpulkan seluruh key bernuansa PIN di dalam payload (rekursif, termasuk embed). */
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

function assertNoPin(
  label: string,
  body: unknown,
  meta: { kind: string; endpoint: string; caller: string; status?: number },
) {
  const leaks = pinKeysIn(body);
  if (leaks.length) recordPinFinding({ ...meta, label, keys: leaks });
  expect(leaks, `${label} membocorkan field PIN: ${leaks.join(", ")}`).toEqual([]);
}

const CALLERS: Caller[] = USER_TOKEN ? ["anon", "member"] : ["anon"];

/** Daftar tabel Data API diambil dari tipe hasil generate (sumber kebenaran skema). */
function tablesFromTypes(): string[] {
  const src = readFileSync("src/integrations/supabase/types.ts", "utf8");
  const start = src.indexOf("Tables: {");
  const end = src.indexOf("\n      Views: {", start);
  const block = src.slice(start, end === -1 ? undefined : end);
  const names = new Set<string>();
  for (const m of block.matchAll(/^      ([a-z0-9_]+): \{$/gm)) names.add(m[1]!);
  return [...names].sort();
}

const tables = tablesFromTypes();

d("Data API — tidak ada field PIN pada respons tabel", () => {
  it("daftar tabel Data API tersedia untuk diuji", () => {
    expect(tables.length).toBeGreaterThan(10);
  });

  for (const caller of CALLERS) {
    it(
      `select=* untuk setiap tabel tidak pernah mengembalikan field PIN (${caller})`,
      async () => {
        const leaks: string[] = [];
        for (const table of tables) {
          const { status, body } = await api(caller, `${table}?select=*&limit=5`);
          if (status !== 200) continue; // ditolak RLS/grant = aman
          const found = pinKeysIn(body);
          if (found.length) {
            leaks.push(`${table}: ${found.join(", ")}`);
            recordPinFinding({
              kind: "table",
              label: `${table} (select=*)`,
              endpoint: `${table}?select=*&limit=5`,
              caller,
              status,
              keys: found,
            });
          }
        }
        expect(leaks, `Field PIN bocor untuk ${caller}`).toEqual([]);
      },
      120_000,
    );

    it(`permintaan eksplisit kolom PIN ditolak (${caller})`, async () => {
      for (const [table, col] of [
        ["customers", "pin"],
        ["profiles", "pin"],
        ["business_members", "staff_pin"],
        ["preparation_jobs", "delivered_pin"],
      ] as const) {
        const path = `${table}?select=id,${col}&limit=1`;
        const { status, body } = await api(caller, path);
        if (status === 200) {
          recordPinFinding({
            kind: "explicit-column",
            label: `${table}.${col} dapat diminta eksplisit`,
            endpoint: path,
            caller,
            status,
            keys: [col],
          });
        }
        expect(status, `${table}.${col} untuk ${caller} seharusnya ditolak`).not.toBe(200);
        assertNoPin(`${table}.${col} (${caller})`, body, {
          kind: "explicit-column",
          endpoint: path,
          caller,
          status,
        });
      }
    });
  }
});

d("Payload join/embed chat, order & ledger bebas PIN", () => {
  const EMBEDS: Array<[string, string]> = [
    ["chat: pesan + pengirim", "messages?select=*,sender:profiles(*)&limit=5"],
    ["chat: percakapan + anggota + profil", "conversations?select=*,conversation_members(*,profiles(*))&limit=5"],
    ["chat: pesanan chat + pelanggan", "chat_orders?select=*,customers(*)&limit=5"],
    ["chat: item pesanan + varian", "chat_order_items?select=*,product_variants(*)&limit=5"],
    ["ledger: ledger + pelanggan + pembayaran", "ledgers?select=*,customers(*),ledger_payments(*)&limit=5"],
    ["ledger: kejadian ledger + ledger", "ledger_events?select=*,ledgers(*)&limit=5"],
    ["bisnis: anggota + profil", "business_members?select=*,profiles(*)&limit=5"],
    ["bisnis: bisnis + anggota", "businesses?select=*,business_members(*)&limit=5"],
    ["penyiapan: job + item + pelanggan", "preparation_jobs?select=*,preparation_job_items(*),customers(*)&limit=5"],
    ["penjualan: sales_records + pelanggan", "sales_records?select=*,customers(*)&limit=5"],
  ];

  for (const caller of CALLERS) {
    for (const [label, path] of EMBEDS) {
      it(`${label} (${caller})`, async () => {
        const { status, body } = await api(caller, path);
        assertNoPin(`${label} (${caller})`, body, { kind: "embed", endpoint: path, caller, status });
      }, 30_000);
    }
  }
});

d("Endpoint RPC tidak membocorkan PIN ke anon", () => {
  const RPCS: Array<[string, Record<string, unknown>]> = [
    ["conversation_overview", {}],
    ["my_pin", {}],
    ["pins_for_me", { _ids: ["00000000-0000-0000-0000-000000000000"] }],
    ["profile_full", { _id: "00000000-0000-0000-0000-000000000000" }],
    ["customer_pin", { _customer: "00000000-0000-0000-0000-000000000000" }],
    ["business_staff_directory", { _business: "00000000-0000-0000-0000-000000000000" }],
    ["search_profile_by_pin", { _pin: "000000" }],
  ];

  for (const [fn, args] of RPCS) {
    it(`rpc ${fn} untuk anon tidak mengembalikan PIN`, async () => {
      const { status, body } = await api("anon", `rpc/${fn}`, {
        method: "POST",
        body: JSON.stringify(args),
      });
      expect(status, `rpc ${fn} untuk anon seharusnya ditolak`).not.toBe(200);
      assertNoPin(`rpc ${fn} (anon)`, body, {
        kind: "rpc",
        endpoint: `rpc/${fn}`,
        caller: "anon",
        status,
      });
    }, 30_000);
  }

  it("rpc business_staff_directory untuk bisnis asing tidak membocorkan staff_pin", async () => {
    if (!USER_TOKEN) return;
    const { status, body } = await api("member", "rpc/business_staff_directory", {
      method: "POST",
      body: JSON.stringify({ _business: "00000000-0000-0000-0000-000000000000" }),
    });
    if (status === 200) expect(body).toEqual([]);
    assertNoPin("business_staff_directory (bisnis asing)", body, {
      kind: "rpc",
      endpoint: "rpc/business_staff_directory",
      caller: "member",
      status,
    });
  }, 30_000);
});

/** Selalu tulis artefak (juga saat bersih) agar CI punya bukti per build. */
afterAll(() => {
  writePinReport();
});
