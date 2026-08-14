import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tahap 2A — koreksi final.
 *
 * Hubungan "diterima" hanya boleh berasal dari `contact_connections` aktif.
 * Dua kartu kontak mutual (QR/manual) TIDAK pernah berarti terhubung.
 * Tes membaca bentuk akhir seluruh migration (urut nama file = urut eksekusi)
 * dan sumber klien, sehingga regresi desain langsung gagal di CI.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const SRC = path.resolve(process.cwd(), "src");

function loadMigrations(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const sql = loadMigrations();

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
const has = (p: RegExp) => lastIndexOfPattern(p) !== -1;

/** Definisi terakhir sebuah fungsi (bentuk yang benar-benar berlaku). */
function lastFunctionBody(name: string): string {
  const re = new RegExp(
    `create or replace function public\\.${name}\\s*\\([^;]*?\\$\\$(.*?)\\$\\$`,
    "gs",
  );
  let body = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1] ?? "";
  return body;
}

function readAll(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) readAll(p, acc);
    else if (/\.(ts|tsx)$/.test(entry.name) && !p.includes("__tests__")) acc.push(p);
  }
  return acc;
}
const clientFiles = readAll(SRC).map((p) => ({ p, text: readFileSync(p, "utf8") }));

describe("SSOT hubungan diterima", () => {
  it("tabel canonical contact_connections ada dengan pasangan unik, non-self, dan audit", () => {
    expect(has(/create table if not exists public\.contact_connections/)).toBe(true);
    expect(has(/contact_connections_pair_uniq unique \(user_low, user_high\)/)).toBe(true);
    expect(has(/contact_connections_not_self check \(user_low <> user_high\)/)).toBe(true);
    expect(has(/contact_connections_canonical check \(user_low < user_high\)/)).toBe(true);
    expect(has(/accepted_request_id uuid references public\.contact_requests\(id\)/)).toBe(true);
    expect(has(/disconnected_at timestamptz/)).toBe(true);
  });

  it("backfill hanya dari request accepted, bukan dari kartu mutual", () => {
    const insert =
      sql.match(
        /insert into public\.contact_connections \(user_low, user_high, accepted_request_id, accepted_at\)[^;]*from public\.contact_requests r where r\.status = 'accepted'[^;]*;/s,
      ) ?? [];
    expect(insert.length).toBeGreaterThan(0);
    expect(insert[0]).not.toMatch(/from public\.contacts/);
  });

  it("keputusan hubungan tidak lagi memakai join contacts mutual", () => {
    for (const fn of [
      "can_view_full_profile",
      "pins_for_me",
      "contact_relation",
      "my_connected_contacts",
      "send_contact_request",
      "save_contact_card",
      "can_view_avatar",
    ]) {
      const body = lastFunctionBody(fn);
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toMatch(/join public\.contacts b on b\.owner_id = a\.contact_id/);
      expect(body).toMatch(/are_connected|contact_connections/);
    }
  });

  it("PIN hanya untuk diri sendiri atau hubungan aktif", () => {
    const pins = lastFunctionBody("pins_for_me");
    expect(pins).toMatch(/p\.id = auth\.uid\(\) or public\.are_connected\(auth\.uid\(\), p\.id\)/);
    const full = lastFunctionBody("profile_full");
    expect(full).toMatch(
      /case when p\.id = auth\.uid\(\) or public\.are_connected\(auth\.uid\(\), p\.id\) then p\.pin else null end/,
    );
  });

  it("avatar_privacy hanya untuk diri sendiri", () => {
    expect(lastFunctionBody("profile_full")).toMatch(
      /case when p\.id = auth\.uid\(\) then p\.avatar_privacy else null end/,
    );
  });

  it("avatar mode contacts/contacts_except memakai hubungan aktif", () => {
    const body = lastFunctionBody("can_view_avatar");
    expect(body).toMatch(/'contacts_except' then public\.are_connected\(_owner, _viewer\)/);
    expect(body).toMatch(/else public\.are_connected\(_owner, _viewer\)/);
  });

  it("profile_cards membatasi dan mendeduplikasi payload", () => {
    const body = lastFunctionBody("profile_cards");
    expect(body).toMatch(/distinct x/);
    expect(body).toMatch(/> 100 then raise exception 'too_many_ids'/);
  });
});

describe("atomisitas dan race condition", () => {
  it("lock_contact_pair berbasis pasangan canonical dan advisory xact lock", () => {
    const body = lastFunctionBody("lock_contact_pair");
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).toMatch(/least\(_a,_b\)/);
    expect(body).toMatch(/greatest\(_a,_b\)/);
  });

  it("semua mutasi hubungan mengambil lock pasangan", () => {
    for (const fn of [
      "send_contact_request",
      "respond_contact_request",
      "cancel_contact_request",
      "set_contact_blocked",
      "disconnect_contact",
      "remove_saved_contact",
    ]) {
      expect(lastFunctionBody(fn)).toMatch(/perform public\.lock_contact_pair/);
    }
  });

  it("respond_contact_request memakai select ... for update dan idempoten", () => {
    const body = lastFunctionBody("respond_contact_request");
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/if r\.status = 'accepted' and _action = 'accepted' then/);
    expect(body).toMatch(/on conflict \(user_low, user_high\) do update/);
  });

  it("satu pasangan hanya boleh punya satu baris request (unordered unique)", () => {
    expect(
      has(
        /create unique index contact_requests_pair_uniq on public\.contact_requests \(least\(requester_id,target_id\), greatest\(requester_id,target_id\)\)/,
      ),
    ).toBe(true);
    expect(lastFunctionBody("send_contact_request")).toMatch(
      /least\(requester_id,target_id\) = least\(uid,_target\)/,
    );
  });

  it("pencarian PIN mengunci per pengguna sebelum count + insert", () => {
    const body = lastFunctionBody("search_profile_by_pin");
    const lock = body.indexOf("pg_advisory_xact_lock");
    const count = body.indexOf("from public.pin_search_log");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(count);
    expect(body).toMatch(/recent >= 5 then raise exception 'rate_limited'/);
  });
});

describe("siklus hidup hubungan", () => {
  it("blokir menonaktifkan hubungan dan membatalkan request pending dua arah", () => {
    const body = lastFunctionBody("set_contact_blocked");
    expect(body).toMatch(/update public\.contact_connections set disconnected_at = now\(\)/);
    expect(body).toMatch(/where status = 'pending'/);
  });

  it("unblock tidak mengaktifkan kembali hubungan atau request", () => {
    const body = lastFunctionBody("set_contact_blocked");
    const elseBranch = body.slice(body.lastIndexOf("else"));
    expect(elseBranch).not.toMatch(/contact_connections/);
    expect(elseBranch).not.toMatch(/contact_requests/);
  });

  it("remove_saved_contact menolak memutus hubungan aktif", () => {
    expect(lastFunctionBody("remove_saved_contact")).toMatch(
      /if public\.are_connected\(uid, _target\) then raise exception 'connected_requires_disconnect'/,
    );
  });

  it("disconnect_contact menonaktifkan hubungan dan menjaga audit barisnya", () => {
    const body = lastFunctionBody("disconnect_contact");
    expect(body).toMatch(/set disconnected_at = now\(\)/);
    expect(body).not.toMatch(/delete from public\.contact_connections/);
  });
});

describe("least privilege", () => {
  const CORE = [
    "profiles",
    "contacts",
    "contact_requests",
    "pin_search_log",
    "contact_connections",
  ];

  it("authenticated hanya punya SELECT pada tabel inti", () => {
    const revoke = lastIndexOfPattern(
      /revoke all on table public\.profiles, public\.contacts, public\.contact_requests, public\.pin_search_log, public\.contact_connections from authenticated, anon, public/,
    );
    expect(revoke).toBeGreaterThan(-1);
    for (const t of CORE) {
      const write = lastIndexOfPattern(
        new RegExp(
          `grant [^;]*(insert|update|delete|truncate|trigger|references)[^;]*on (table )?public\\.${t}[^;]*to [^;]*authenticated`,
        ),
      );
      expect(write).toBeLessThan(revoke);
    }
  });

  it("tidak ada policy write langsung pada tabel inti (delete kontak dicabut)", () => {
    expect(has(/drop policy if exists "own contacts delete" on public\.contacts/)).toBe(true);
    const createDelete = lastIndexOfPattern(
      /create policy "own contacts delete" on public\.contacts/,
    );
    expect(createDelete).toBeLessThan(
      lastIndexOfPattern(/drop policy if exists "own contacts delete" on public\.contacts/),
    );
  });

  it("pin_search_log tidak dapat dibaca klien", () => {
    const revoke = lastIndexOfPattern(
      /revoke all on table[^;]*public\.pin_search_log[^;]*from authenticated/,
    );
    expect(
      lastIndexOfPattern(/grant [^;]*on public\.pin_search_log[^;]*to [^;]*authenticated/),
    ).toBeLessThan(revoke);
    expect(has(/drop policy if exists "own search log" on public\.pin_search_log/)).toBe(true);
  });

  it("helper internal tidak executable oleh authenticated/anon", () => {
    for (const fn of ["lock_contact_pair\\(uuid,uuid\\)", "are_connected\\(uuid,uuid\\)"]) {
      expect(
        has(new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`)),
      ).toBe(true);
      expect(has(new RegExp(`grant execute on function public\\.${fn} to authenticated`))).toBe(
        false,
      );
    }
  });

  it("RPC client-facing baru punya grant eksplisit dan tanpa anon/public", () => {
    for (const fn of ["remove_saved_contact", "disconnect_contact"]) {
      expect(sql).toMatch(new RegExp(`'public\\.${fn}\\(uuid\\)'`));
    }
    expect(has(/execute format\('revoke all on function %s from public, anon', f\)/)).toBe(true);
    expect(has(/grant execute on function %s to authenticated, service_role/)).toBe(true);
  });
});

describe("kontrak klien", () => {
  const CORE_TABLES = [
    "profiles",
    "contacts",
    "contact_requests",
    "pin_search_log",
    "contact_connections",
  ];

  it("tidak ada tulis langsung dari klien ke tabel inti", () => {
    for (const { p, text } of clientFiles) {
      if (p.includes(".server.") || p.includes("/push/") || p.includes("functions.ts")) continue;
      for (const t of CORE_TABLES) {
        const re = new RegExp(
          `from\\(["']${t}["']\\)[\\s\\S]{0,80}?\\.(insert|update|delete|upsert)\\(`,
        );
        expect(re.test(text), `${p} menulis langsung ke ${t}`).toBe(false);
      }
    }
  });

  it("UI memakai RPC remove/disconnect, bukan delete langsung", () => {
    const api = readFileSync(path.join(SRC, "lib/api/contacts.ts"), "utf8");
    expect(api).toMatch(/rpc\("remove_saved_contact"/);
    expect(api).toMatch(/rpc\("disconnect_contact"/);
    expect(api).not.toMatch(/from\("contacts"\)\s*\.delete\(\)/);
    expect(api).not.toMatch(/as unknown as/);
  });

  it("status Terhubung dibaca dari relasi server", () => {
    const api = readFileSync(path.join(SRC, "lib/api/contacts.ts"), "utf8");
    expect(api).toMatch(/rpc\("my_connected_contacts"\)/);
    expect(api).toMatch(/rpc\("contact_relation"/);
  });
});

describe("hardening final 2A — profiles tertutup", () => {
  it("authenticated/anon/public tidak punya privilege apa pun pada tabel profiles", () => {
    const revoke = lastIndexOfPattern(
      /revoke all on table public\.profiles from authenticated, anon, public/,
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(
      lastIndexOfPattern(/grant [^;]*on table public\.profiles to [^;]*authenticated/),
    ).toBeLessThan(revoke);
    expect(has(/drop policy if exists "profiles readable when related" on public\.profiles/)).toBe(
      true,
    );
  });

  it("tidak ada pembacaan tabel profiles langsung dari kode aplikasi", () => {
    for (const { p, text } of clientFiles) {
      if (p.endsWith("client.server.ts") || p.includes("/push/dispatch.server.ts")) continue;
      expect(/\.from\(["']profiles["']\)/.test(text), `${p} membaca tabel profiles`).toBe(false);
    }
  });

  it("pembacaan profil klien hanya lewat RPC kontrak-terbatas", () => {
    const api = readFileSync(path.join(SRC, "lib/api/profiles.ts"), "utf8");
    for (const fn of ["my_profile", "profile_cards", "profile_full"])
      expect(api).toMatch(new RegExp(`rpc\\("${fn}"`));
    expect(api).toMatch(/pin: string \| null/);
    expect(api).toMatch(/avatar_privacy: string \| null/);
  });

  it("profile_full memasker PIN dan avatar_privacy, tanpa email/phone", () => {
    const body = lastFunctionBody("profile_full");
    expect(body).toMatch(/case when p\.id = auth\.uid\(\) or public\.are_connected\([^)]*\) then p\.pin else null end/);
    expect(body).toMatch(/case when p\.id = auth\.uid\(\) then p\.avatar_privacy else null end/);
    expect(body).not.toMatch(/email|phone/);
  });
});

describe("hardening final 2A — race & state terminal", () => {
  it("respond_contact_request memvalidasi ulang otorisasi SETELAH pair lock", () => {
    const body = lastFunctionBody("respond_contact_request");
    const lock = body.indexOf("lock_contact_pair");
    const forUpdate = body.indexOf("for update");
    expect(lock).toBeGreaterThan(-1);
    expect(forUpdate).toBeGreaterThan(lock);
    // re-check target, pair, dan keberadaan row hanya sesudah re-read terkunci
    expect(body.indexOf("r.target_id <> uid")).toBeGreaterThan(forUpdate);
    expect(body).toMatch(/least\(r\.requester_id, r\.target_id\) <> lo/);
    expect(body).toMatch(/raise exception 'request_changed'/);
  });

  it("accept idempotent tidak dapat menghidupkan kembali hubungan yang diputus/diblokir", () => {
    const body = lastFunctionBody("respond_contact_request");
    const idem = body.indexOf("r.status = 'accepted' and _action = 'accepted'");
    expect(idem).toBeGreaterThan(-1);
    const branch = body.slice(idem, idem + 400);
    expect(branch).toMatch(/raise exception 'blocked'/);
    expect(branch).toMatch(/not public\.are_connected/);
    expect(branch).toMatch(/raise exception 'connection_revoked'/);
    expect(branch).not.toMatch(/insert into public\.contact_connections/);
  });

  it("accept baru selalu cek block dua arah setelah lock", () => {
    const body = lastFunctionBody("respond_contact_request");
    expect(body).toMatch(/blocked_pair/);
    expect(body).toMatch(/_action = 'accepted' and blocked_pair then raise exception 'blocked'/);
  });

  it("block menjadikan request pending MAUPUN accepted terminal 'blocked'", () => {
    const body = lastFunctionBody("set_contact_blocked");
    expect(body).toMatch(/set status = 'blocked'[^;]*where status in \('pending','accepted'\)/);
    expect(body).toMatch(/set disconnected_at = now\(\)/);
  });

  it("unblock tidak menyambung ulang hubungan, hanya membatalkan request blocked", () => {
    const body = lastFunctionBody("set_contact_blocked");
    const unblock = body.slice(body.indexOf("else"));
    expect(unblock).toMatch(/still_blocked/);
    expect(unblock).toMatch(/set status = 'cancelled'[^;]*where status = 'blocked'/);
    expect(unblock).not.toMatch(/disconnected_at = null/);
    expect(unblock).not.toMatch(/insert into public\.contact_connections/);
  });
});
