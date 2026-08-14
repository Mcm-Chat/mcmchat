import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tahap 2B — koreksi wajib.
 *
 * Membuktikan (a) regresi izin runtime tertutup: tidak ada policy yang memanggil
 * helper arbitrary-user, (b) kapabilitas terpecah per aksi, (c) RPC grup/bisnis
 * mengunci lebih dulu sebelum otorisasi di-recheck.
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

function lastFunctionBody(name: string): string {
  const re = new RegExp(
    `create or replace function public\\.${name}\\s*\\([^;]*?\\$(?:fn|function)?\\$(.*?)\\$(?:fn|function)?\\$`,
    "gs",
  );
  let body = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1] ?? "";
  return body;
}

/** Bentuk akhir setiap policy (definisi terakhir menang). */
function finalPolicies(): Map<string, string> {
  const re = /create policy "([^"]+)" on ([a-z_.]+)(.*?);/gs;
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.set(`${m[2]}::${m[1]}`, m[3] ?? "");
  return out;
}

const ARBITRARY_HELPERS = [
  "is_conv_member",
  "conv_role_of",
  "can_use_conversation",
  "is_business_member",
  "can_manage_business",
  "can_sell_business",
  "business_role_of",
];

describe("koreksi 2B — policy tidak boleh memanggil helper arbitrary-user", () => {
  it("tidak ada policy aktif yang memakai helper yang dicabut dari authenticated", () => {
    const offenders: string[] = [];
    for (const [key, body] of finalPolicies()) {
      for (const h of ARBITRARY_HELPERS) {
        // current_user_business_role bukan helper arbitrary-user.
        if (new RegExp(`(?<!current_user_)\\b${h}\\s*\\(`).test(body)) {
          offenders.push(`${key} -> ${h}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("helper self-scoped tersedia untuk authenticated", () => {
    for (const fn of [
      "current_user_can_read_conversation",
      "current_user_can_send_conversation",
      "current_user_can_call_conversation",
      "current_user_can_manage_conversation",
      "current_user_is_business_member",
      "current_user_can_manage_business",
      "current_user_can_sell_business",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(uuid\\) to authenticated`));
    }
  });

  it("helper arbitrary-user dicabut dari authenticated", () => {
    for (const fn of ["can_manage_business", "can_sell_business", "is_business_member", "business_role_of", "can_use_conversation"]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\(uuid,uuid\\) from public, anon, authenticated`),
      );
    }
  });
});

describe("koreksi 2B — kapabilitas terpecah per aksi", () => {
  const cap = lastFunctionBody("conversation_capability");

  it("mengembalikan readable/sendable/callable/manageable", () => {
    expect(sql).toMatch(
      /create or replace function public\.conversation_capability[\s\S]*?returns table\(readable boolean, sendable boolean, callable boolean, manageable boolean/,
    );
  });

  it("direct yang diputus/diblokir tetap readable tetapi tidak sendable", () => {
    expect(cap).toMatch(/readable := true;\s*select d\.user_low/);
    expect(cap).toMatch(/pair_blocked/);
    expect(cap).toMatch(/reason := 'blocked'/);
    expect(cap).toMatch(/reason := 'disconnected'/);
  });

  it("viewer bisnis hanya membaca, agen hanya saat ditugaskan", () => {
    expect(cap).toMatch(/_brole = 'viewer' then readable := true; reason := 'read_only'/);
    expect(cap).toMatch(/sendable := coalesce\(_assignee = _user, false\)/);
  });

  it("mengirim pesan diikat sendable, membaca diikat readable", () => {
    const p = finalPolicies();
    expect(p.get("public.messages::member sends messages")).toMatch(
      /current_user_can_send_conversation\(conversation_id\)/,
    );
    expect(p.get("public.messages::member reads messages")).toMatch(
      /current_user_can_read_conversation\(conversation_id\)/,
    );
  });

  it("panggilan memakai kapabilitas callable", () => {
    expect(lastFunctionBody("create_call_tx")).toMatch(/current_user_can_call_conversation/);
  });
});

describe("koreksi 2B — race grup dan bisnis", () => {
  for (const fn of [
    "add_group_members",
    "remove_group_member",
    "set_group_member_role",
    "transfer_group_ownership",
    "update_group_settings",
  ]) {
    it(`${fn} mengunci percakapan sebelum otorisasi`, () => {
      const body = lastFunctionBody(fn);
      const lock = body.indexOf("for update");
      const auth = body.indexOf("assert_group_manager");
      expect(lock).toBeGreaterThan(-1);
      expect(auth).toBeGreaterThan(lock);
    });
  }

  it("set_conversation_assignee mengunci lalu mencatat penangan sebagai anggota", () => {
    const body = lastFunctionBody("set_conversation_assignee");
    expect(body.indexOf("for update")).toBeGreaterThan(-1);
    expect(body).toMatch(/insert into public\.conversation_members/);
  });

  it("hanya boleh ada satu owner per percakapan", () => {
    expect(sql).toMatch(
      /create unique index if not exists conversation_members_single_owner on public\.conversation_members \(conversation_id\) where role = 'owner'/,
    );
  });

  it("owner tidak dapat keluar tanpa memindahkan kepemilikan", () => {
    expect(lastFunctionBody("leave_conversation")).toMatch(/last_owner/);
  });

  it("grup baru minimal dua anggota", () => {
    expect(lastFunctionBody("create_group")).toMatch(/grup minimal dua anggota/);
  });

  it("percakapan bisnis punya registry kanonik dan menolak staf sebagai pelanggan", () => {
    expect(sql).toMatch(/create table if not exists public\.business_conversations/);
    expect(sql).toMatch(/business_conversations_pair_unique unique \(business_id, customer_id\)/);
    expect(lastFunctionBody("get_or_create_business_conversation")).toMatch(
      /pelanggan tidak boleh staf bisnis/,
    );
  });
});
