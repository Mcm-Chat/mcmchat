import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { recordPinFinding, writePinReport } from "./helpers/pin-report";

/**
 * Kanal Realtime (join/chat/ledger events) adalah jalur baca ketiga di samping
 * Data API dan RPC: payload `postgres_changes` dikirim dari WAL, jadi kolom
 * rahasia bisa bocor walaupun GRANT tabel sudah rapat.
 *
 * Dua lapis bukti:
 *  1. Skema (psql): tidak ada tabel di publikasi `supabase_realtime` yang
 *     menyiarkan kolom PIN, dan tabel pemilik PIN tidak boleh REPLICA IDENTITY
 *     FULL (old record membawa seluruh baris, termasuk PIN).
 *  2. Live (websocket Realtime): berlangganan sebagai anon — dan sebagai user
 *     bila token tersedia — untuk tabel chat/ledger/penyiapan, lalu memastikan
 *     tidak ada payload yang membawa field PIN.
 */

const HAS_DB = Boolean(process.env["PGHOST"]);
const URL_BASE = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_ANON_KEY"] ??
  "";
const USER_TOKEN = process.env["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"] ?? "";
const HAS_API = Boolean(URL_BASE && ANON);
const STRICT = process.env["PIN_GATE_STRICT"] === "1";

const db = HAS_DB ? describe : describe.skip;
const api = HAS_API ? describe : describe.skip;

describe("gate Realtime PIN wajib aktif di CI", () => {
  it("kredensial tersedia saat PIN_GATE_STRICT=1", () => {
    expect(
      (HAS_DB && HAS_API) || !STRICT,
      "PIN_GATE_STRICT=1 tetapi PGHOST/SUPABASE_URL tidak diset: gate Realtime PIN tidak dieksekusi",
    ).toBe(true);
  });
});

/** Kolom rahasia yang tidak boleh pernah keluar lewat WAL/Realtime. */
const SECRET_COLUMNS = ["pin", "staff_pin", "delivered_pin", "pin_hash", "pin_code"];

const PIN_KEY = /(^|_)pins?$|(^|_)pin_?(code|hash)$/;
function isPinKey(key: string): boolean {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return PIN_KEY.test(snake);
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

function q(sql: string): string[] {
  return execFileSync("psql", ["-At", "-c", sql], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const cols = SECRET_COLUMNS.map((c) => `'${c}'`).join(",");

db("publikasi supabase_realtime tidak menyiarkan kolom PIN", () => {
  it("tidak ada tabel terpublikasi yang menyertakan kolom PIN", () => {
    const rows = q(`
      select pt.tablename || '.' || col
      from pg_publication_tables pt
      cross join lateral unnest(pt.attnames) as col
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and col in (${cols})
    `);
    for (const row of rows) {
      const [table = "", key = ""] = row.split(".");
      recordPinFinding({
        kind: "realtime-publication",
        label: `${table} disiarkan Realtime dengan kolom PIN`,
        endpoint: `realtime:public.${table}`,
        caller: "any",
        keys: [key],
      });
    }
    expect(rows, "kolom PIN masuk publikasi Realtime").toEqual([]);
  });

  it("tabel pemilik kolom PIN tidak memakai REPLICA IDENTITY FULL", () => {
    // FULL membuat old record pada UPDATE/DELETE membawa seluruh baris,
    // sehingga daftar kolom publikasi tidak lagi cukup melindungi PIN.
    const rows = q(`
      select c.relname
      from pg_class c
      join pg_publication_tables pt
        on pt.tablename = c.relname and pt.schemaname = 'public' and pt.pubname = 'supabase_realtime'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace
        and a.attname in (${cols})
        and c.relreplident = 'f'
    `);
    for (const table of rows) {
      recordPinFinding({
        kind: "realtime-replica-identity",
        label: `${table} REPLICA IDENTITY FULL menyiarkan baris lama berisi PIN`,
        endpoint: `realtime:public.${table}`,
        caller: "any",
        keys: ["old_record.*"],
      });
    }
    expect(rows).toEqual([]);
  });

  it("publikasi Realtime memang aktif (tes tidak lulus karena kosong)", () => {
    const rows = q(
      `select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'`,
    );
    expect(rows.length).toBeGreaterThan(3);
    expect(rows).toContain("messages");
  });
});

/** Tabel kanal yang dipakai UI: chat, panggilan/join, penyiapan & ledger. */
const CHANNEL_TABLES = [
  "messages",
  "conversations",
  "conversation_members",
  "message_receipts",
  "contact_requests",
  "calls",
  "call_participants",
  "preparation_jobs",
  "preparation_job_items",
];

api("kanal Realtime — payload tanpa field PIN", () => {
  for (const caller of USER_TOKEN ? (["anon", "member"] as const) : (["anon"] as const)) {
    it(
      `langganan postgres_changes tidak pernah membawa field PIN (${caller})`,
      async () => {
        const { createClient } = await import("@supabase/supabase-js");
        const client = createClient(URL_BASE, ANON, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });
        if (caller === "member") await client.realtime.setAuth(USER_TOKEN);

        const leaks: string[] = [];
        const channel = client.channel(`pin-audit-${caller}-${Date.now()}`);
        for (const table of CHANNEL_TABLES) {
          channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
            const found = [
              ...pinKeysIn(payload.new ?? null, "$.new"),
              ...pinKeysIn(payload.old ?? null, "$.old"),
            ];
            if (found.length) {
              leaks.push(`${table}: ${found.join(", ")}`);
              recordPinFinding({
                kind: "realtime-payload",
                label: `payload realtime ${table}`,
                endpoint: `realtime:public.${table}`,
                caller,
                keys: found,
              });
            }
          });
        }

        const status = await new Promise<string>((resolve) => {
          const t = setTimeout(() => resolve("TIMED_OUT"), 15_000);
          channel.subscribe((s) => {
            if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
              clearTimeout(t);
              resolve(s);
            }
          });
        });

        // Beri jendela singkat untuk menampung event yang lewat saat tes berjalan.
        if (status === "SUBSCRIBED") await new Promise((r) => setTimeout(r, 4_000));

        await client.removeChannel(channel);
        client.realtime.disconnect();

        expect(leaks, `payload Realtime membocorkan PIN untuk ${caller}`).toEqual([]);
      },
      45_000,
    );
  }
});

afterAll(() => {
  writePinReport();
});
