import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { globSync } from "tinyglobby";
import { recordPinFinding, writePinReport } from "./helpers/pin-report";

/**
 * Storage adalah jalur baca keempat setelah Data API, RPC, dan Realtime.
 * Objek chat (chat-media) dan bisnis (product-photos, avatars, status-media)
 * membawa metadata sendiri (name, path_tokens, metadata, user_metadata) yang
 * ikut dikembalikan oleh endpoint list/objek — jadi PIN bisa bocor lewat nama
 * berkas atau metadata walau semua GRANT tabel sudah rapat.
 *
 * Tiga lapis bukti:
 *  1. Sumber: tidak ada pemanggilan upload yang menaruh PIN pada path/metadata.
 *  2. Skema (psql): bucket chat/bisnis privat, tidak ada objek dengan field PIN,
 *     dan storage.objects tidak disiarkan lewat publikasi Realtime.
 *  3. Live (REST): endpoint list/objek Storage untuk anon dan user tidak pernah
 *     mengembalikan field PIN.
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

/** Bucket yang dipakai alur chat dan bisnis. */
const BUCKETS = ["chat-media", "product-photos", "avatars", "status-media", "stickers"];

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

describe("gate Storage PIN wajib aktif di CI", () => {
  it("kredensial tersedia saat PIN_GATE_STRICT=1", () => {
    expect(
      (HAS_DB && HAS_API) || !STRICT,
      "PIN_GATE_STRICT=1 tetapi PGHOST/SUPABASE_URL tidak diset: gate Storage PIN tidak dieksekusi",
    ).toBe(true);
  });
});

describe("sumber: upload tidak pernah menaruh PIN pada objek Storage", () => {
  it("tidak ada path/metadata upload yang memakai variabel PIN", () => {
    const files = globSync(["src/**/*.ts", "src/**/*.tsx"], {
      ignore: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    });
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!src.includes(".storage")) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        const isUpload = /\.upload\(|\.uploadToSignedUrl\(|user_metadata|contentType/.test(line);
        if (!isUpload) return;
        // Ambil blok kecil sekitar pemanggilan agar argumen multi-baris ikut terperiksa.
        const block = lines.slice(Math.max(0, i - 3), i + 6).join("\n");
        if (/\bpin\b|Pin\b|_pin|pin_/.test(block)) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    for (const at of offenders) {
      recordPinFinding({
        kind: "storage-source",
        label: `pemanggilan upload Storage menyinggung PIN (${at})`,
        endpoint: "source:storage.upload",
        caller: "build",
        keys: ["pin"],
      });
    }
    expect(offenders, "PIN dipakai pada path/metadata upload Storage").toEqual([]);
  });
});

db("skema Storage: bucket privat dan metadata bebas PIN", () => {
  it("bucket chat & bisnis tidak publik", () => {
    const pub = q(
      `select id from storage.buckets where public = true and id in (${BUCKETS.map((b) => `'${b}'`).join(",")})`,
    );
    for (const bucket of pub) {
      recordPinFinding({
        kind: "storage-bucket-public",
        label: `bucket ${bucket} publik: objek bisa dibaca tanpa auth`,
        endpoint: `storage:${bucket}`,
        caller: "anon",
        keys: ["object.*"],
      });
    }
    expect(pub, "bucket chat/bisnis tidak boleh publik").toEqual([]);
  });

  it("tidak ada objek dengan field PIN pada nama/metadata", () => {
    const rows = q(`
      select o.bucket_id || '/' || o.name
      from storage.objects o
      where o.name ~* '(^|[^a-z])pins?([^a-z]|$)'
         or coalesce(o.metadata::text, '') ~* '"[a-z_]*pin[a-z_]*"'
         or coalesce(o.user_metadata::text, '') ~* '"[a-z_]*pin[a-z_]*"'
      limit 50
    `);
    for (const row of rows) {
      recordPinFinding({
        kind: "storage-object-metadata",
        label: `objek Storage membawa field/nama PIN`,
        endpoint: `storage:${row.split("/")[0]}`,
        caller: "any",
        keys: ["object.metadata.pin"],
      });
    }
    expect(rows, "objek Storage membawa PIN pada nama atau metadata").toEqual([]);
  });

  it("storage.objects tidak disiarkan lewat publikasi Realtime", () => {
    const rows = q(`
      select schemaname || '.' || tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'storage'
    `);
    expect(rows, "tabel storage tidak boleh masuk publikasi Realtime").toEqual([]);
  });

  it("anon tidak punya GRANT tulis pada storage.objects", () => {
    const rows = q(`
      select privilege_type
      from information_schema.role_table_grants
      where table_schema = 'storage' and table_name = 'objects'
        and grantee = 'anon'
        and privilege_type in ('INSERT','UPDATE','DELETE')
    `);
    expect(rows, "anon tidak boleh menulis objek Storage").toEqual([]);
  });
});

api("live REST Storage: respons tanpa field PIN", () => {
  const callers: Array<{ name: string; token: string }> = [{ name: "anon", token: ANON }];
  if (USER_TOKEN) callers.push({ name: "member", token: USER_TOKEN });

  for (const caller of callers) {
    it(
      `endpoint list/objek Storage tidak mengembalikan field PIN (${caller.name})`,
      async () => {
        const leaks: string[] = [];
        for (const bucket of BUCKETS) {
          const endpoint = `/storage/v1/object/list/${bucket}`;
          const res = await fetch(`${URL_BASE}${endpoint}`, {
            method: "POST",
            headers: {
              apikey: ANON,
              Authorization: `Bearer ${caller.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ prefix: "", limit: 100, offset: 0 }),
          });
          let body: unknown = null;
          try {
            body = await res.json();
          } catch {
            body = null;
          }
          const found = pinKeysIn(body);
          if (found.length) {
            leaks.push(`${bucket}: ${found.join(", ")}`);
            recordPinFinding({
              kind: "storage-list",
              label: `list objek ${bucket} membawa field PIN`,
              endpoint,
              caller: caller.name,
              status: res.status,
              keys: found,
            });
          }
        }
        expect(leaks, `respons Storage membocorkan PIN untuk ${caller.name}`).toEqual([]);
      },
      45_000,
    );
  }

  it("objek bucket privat tidak bisa diambil tanpa signed URL (anon)", async () => {
    for (const bucket of BUCKETS) {
      const res = await fetch(`${URL_BASE}/storage/v1/object/public/${bucket}/probe.jpg`, {
        headers: { apikey: ANON },
      });
      expect(res.status, `${bucket} melayani objek publik tanpa auth`).not.toBe(200);
    }
  }, 45_000);
});

afterAll(() => {
  writePinReport();
});
