import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tahap 2B — otorisasi percakapan direct, grup, dan business.
 *
 * Invarian statis atas bentuk akhir seluruh migration (urut nama file = urut
 * eksekusi) dan sumber klien. Ini membuktikan desain/ACL, BUKAN race runtime:
 * pembuktian paralel dua sesi tetap perlu uji manual multi-akun.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const SRC = path.resolve(process.cwd(), "src");

const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

function lastIndexOfPattern(pattern: RegExp): number {
  const re = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) idx = m.index;
  return idx;
}
const has = (p: RegExp) => lastIndexOfPattern(p) !== -1;

function lastFunctionBody(name: string): string {
  const re = new RegExp(
    `create or replace function public\\.${name}\\s*\\([^;]*?\\$(?:function)?\\$(.*?)\\$(?:function)?\\$`,
    "gs",
  );
  let body = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) body = m[1] ?? "";
  return body;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(SRC).filter(
  (f) => !f.includes("__tests__") && !f.includes(path.join("integrations", "supabase")),
);

describe("2B — SSOT percakapan langsung", () => {
  it("tabel kanonik memaksa satu percakapan per pasangan terurut", () => {
    expect(has(/create table if not exists public\.direct_conversations/)).toBe(true);
    expect(has(/check \(user_low < user_high\)/)).toBe(true);
    expect(has(/direct_conversations_pair_unique unique \(user_low, user_high\)/)).toBe(true);
    expect(has(/conversation_id uuid primary key references public\.conversations\(id\)/)).toBe(
      true,
    );
  });

  it("hanya kedua pihak yang dapat membaca, tanpa hak tulis klien", () => {
    expect(has(/create policy "direct pair reads canonical" on public\.direct_conversations/)).toBe(
      true,
    );
    const revoke = lastIndexOfPattern(
      /revoke all on table public\.direct_conversations from authenticated, anon, public/,
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(
      lastIndexOfPattern(
        /grant (insert|update|delete|all) on table public\.direct_conversations to [^;]*authenticated/,
      ),
    ).toBeLessThan(revoke);
  });

  it("get_or_create_direct atomik: lock pair, cek koneksi & blokir sesudah lock", () => {
    const body = lastFunctionBody("get_or_create_direct");
    const lock = body.indexOf("lock_conversation_pair");
    expect(lock).toBeGreaterThan(-1);
    expect(body.indexOf("are_connected")).toBeGreaterThan(lock);
    expect(body.indexOf("pair_blocked")).toBeGreaterThan(lock);
    // reuse kanonik sebelum insert baru → reconnect memakai riwayat yang sama
    expect(body.indexOf("from public.direct_conversations")).toBeLessThan(
      body.indexOf("insert into public.conversations"),
    );
    // tepat dua anggota dalam satu transaksi
    expect(body).toMatch(/values \(_conv, _uid, 'member'\), \(_conv, _other, 'member'\)/);
    expect(body).toMatch(/not_connected/);
    expect(body).toMatch(/blocked:/);
    expect(body).toMatch(/_other = _uid/);
  });

  it("kapabilitas direct menuntut koneksi aktif dan tanpa blokir", () => {
    const body = lastFunctionBody("can_use_conversation");
    expect(body).toMatch(/direct_conversations/);
    expect(body).toMatch(/are_connected/);
    expect(body).toMatch(/not public\.pair_blocked/);
  });

  it("panggilan direct memakai kapabilitas, bukan sekadar keanggotaan", () => {
    const body = lastFunctionBody("create_call_tx");
    expect(body).toMatch(/can_use_conversation/);
    expect(body).toMatch(/not_connected/);
  });

  it("conversation_overview menandai usable dan tidak menambah unread saat nonaktif", () => {
    const body = lastFunctionBody("conversation_overview");
    expect(body).toMatch(/can_use_conversation/);
    expect(body).toMatch(/case when mine\.usable then/);
  });
});

describe("2B — role dan state machine grup", () => {
  it("role dibatasi owner/admin/member", () => {
    expect(
      has(/conversation_members_role_valid check \(role in \('owner','admin','member'\)\)/),
    ).toBe(true);
  });

  it("pembuat grup menjadi satu-satunya owner", () => {
    const body = lastFunctionBody("create_group");
    expect(body).toMatch(/values \(_conv, _uid, 'owner'\)/);
    expect(body).toMatch(/x <> _uid/);
    expect(body).toMatch(/are_connected/);
    expect(body).toMatch(/pair_blocked/);
    expect(body).toMatch(/max_members/);
    expect(body).toMatch(/invalid_title/);
  });

  it("add/remove/role/transfer memakai gate manager dan row lock", () => {
    for (const fn of [
      "add_group_members",
      "remove_group_member",
      "set_group_member_role",
      "transfer_group_ownership",
    ]) {
      const body = lastFunctionBody(fn);
      expect(body, fn).toMatch(/assert_group_manager/);
      expect(body, fn).toMatch(/for update/);
    }
  });

  it("promote/demote owner-only dan tidak ada self-promotion", () => {
    const body = lastFunctionBody("set_group_member_role");
    expect(body).toMatch(/assert_group_manager\(_conversation, _uid, true\)/);
    expect(body).toMatch(/_role not in \('admin','member'\)/);
    expect(body).toMatch(/_target = _uid/);
    expect(body).toMatch(/_trole = 'owner'/);
  });

  it("owner tidak dapat dikeluarkan dan admin tidak dapat mengeluarkan admin", () => {
    const body = lastFunctionBody("remove_group_member");
    expect(body).toMatch(/_trole = 'owner'/);
    expect(body).toMatch(/_actor = 'admin' and _trole = 'admin'/);
  });

  it("transfer kepemilikan atomik satu owner baru", () => {
    const body = lastFunctionBody("transfer_group_ownership");
    expect(body.indexOf("set role = 'admin'")).toBeLessThan(body.indexOf("set role = 'owner'"));
  });

  it("owner terakhir tidak dapat keluar dan direct tidak dapat ditinggalkan", () => {
    const body = lastFunctionBody("leave_conversation");
    expect(body).toMatch(/last_owner/);
    expect(body).toMatch(/direct_invariant/);
  });

  it("RPC grup menolak percakapan direct", () => {
    expect(lastFunctionBody("assert_group_manager")).toMatch(/direct_invariant/);
  });

  it("pengaturan grup tervalidasi rentang dan panjang", () => {
    const body = lastFunctionBody("update_group_settings");
    expect(body).toMatch(/invalid_title/);
    expect(body).toMatch(/_disappearing_hours < 0 or _disappearing_hours > 8760/);
  });
});

describe("2B — preferensi dan read state", () => {
  it("preferensi hanya tiga kolom milik auth.uid", () => {
    const body = lastFunctionBody("update_my_conversation_preferences");
    expect(body).toMatch(/user_id = _uid/);
    expect(body).toMatch(/is_muted = coalesce/);
    expect(body).toMatch(/is_pinned = coalesce/);
    expect(body).toMatch(/is_archived = coalesce/);
    const setClause = body.slice(body.indexOf(" set "), body.indexOf(" where "));
    expect(setClause).not.toMatch(/\brole\s*=/);
    expect(setClause).not.toMatch(/\buser_id\s*=/);
    expect(setClause).not.toMatch(/conversation_id\s*=/);
    expect(body).toMatch(/where conversation_id = _conversation and user_id = _uid/);
  });

  it("mark_conversation_read memakai cursor server dan hanya baris sendiri", () => {
    const body = lastFunctionBody("mark_conversation_read");
    expect(body).toMatch(/is_conv_member\(_conversation, _uid\)/);
    expect(body).toMatch(/least\(coalesce\(_cursor, now\(\)\), now\(\)\)/);
    expect(body).toMatch(/user_id = _uid/);
    expect(body).toMatch(/m\.conversation_id = _conversation/);
  });
});

describe("2B — business conversation", () => {
  it("hanya pemilik/admin bisnis yang membuat percakapan bisnis", () => {
    const body = lastFunctionBody("get_or_create_business_conversation");
    expect(body).toMatch(/can_manage_business/);
    expect(body).toMatch(/lock_conversation_pair/);
  });

  it("assignee wajib anggota bisnis dan inbox hanya aktor berwenang", () => {
    expect(lastFunctionBody("set_conversation_assignee")).toMatch(/is_business_member\(_biz, _assignee\)/);
    expect(lastFunctionBody("set_conversation_inbox_status")).toMatch(/can_sell_business/);
  });

  it("admin bisnis tidak dapat mengangkat owner (anti eskalasi)", () => {
    expect(
      has(
        /role <> 'owner' or public\.business_role_of\(business_id, auth\.uid\(\)\) = 'owner'/,
      ),
    ).toBe(true);
  });
});

describe("2B — ACL akhir", () => {
  it("tidak ada hak tulis langsung pada conversations/conversation_members", () => {
    for (const t of ["conversations", "conversation_members"]) {
      const revoke = lastIndexOfPattern(
        new RegExp(`revoke all on table public\\.${t} from authenticated, anon, public`),
      );
      expect(revoke, t).toBeGreaterThan(-1);
      expect(
        lastIndexOfPattern(
          new RegExp(`grant (insert|update|delete|all)[^;]*on table public\\.${t} to [^;]*authenticated`),
        ),
        t,
      ).toBeLessThan(revoke);
    }
  });

  it("policy tulis lama sudah dihapus", () => {
    for (const p of [
      "creator inserts conversation",
      "creator deletes conversation",
      "member updates conversation",
      "member adds members",
      "admin removes members",
      "own membership delete",
      "own membership update",
    ]) {
      expect(has(new RegExp(`drop policy if exists "${p}"`)), p).toBe(true);
    }
  });

  it("helper internal tidak executable oleh authenticated", () => {
    for (const fn of [
      "lock_conversation_pair\\(uuid,uuid\\)",
      "pair_blocked\\(uuid,uuid\\)",
      "can_use_conversation\\(uuid,uuid\\)",
      "conv_role_of\\(uuid,uuid\\)",
      "assert_group_manager\\(uuid,uuid,boolean\\)",
      "is_conv_member\\(uuid,uuid\\)",
      "is_conv_admin\\(uuid,uuid\\)",
    ]) {
      const revoke = lastIndexOfPattern(
        new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`),
      );
      expect(revoke, fn).toBeGreaterThan(-1);
      expect(
        lastIndexOfPattern(new RegExp(`grant execute on function public\\.${fn} to [^;]*authenticated`)),
        fn,
      ).toBeLessThan(revoke);
    }
  });

  it("RPC klien security definer + search_path + tanpa anon", () => {
    for (const fn of [
      "get_or_create_direct\\(uuid\\)",
      "create_group\\(text, uuid\\[\\]\\)",
      "add_group_members\\(uuid, uuid\\[\\]\\)",
      "remove_group_member\\(uuid, uuid\\)",
      "set_group_member_role\\(uuid, uuid, text\\)",
      "transfer_group_ownership\\(uuid, uuid\\)",
      "leave_conversation\\(uuid\\)",
      "update_group_settings\\(uuid, text, text, integer\\)",
      "update_my_conversation_preferences\\(uuid, boolean, boolean, boolean\\)",
      "mark_conversation_read\\(uuid, uuid\\)",
      "get_or_create_business_conversation\\(uuid, uuid\\)",
      "set_conversation_assignee\\(uuid, uuid\\)",
      "set_conversation_inbox_status\\(uuid, inbox_status\\)",
      "create_call_tx\\(uuid, call_kind, integer\\)",
      "conversation_overview\\(\\)",
      "my_conversation_capability\\(uuid\\)",
    ]) {
      expect(
        has(new RegExp(`revoke all on function public\\.${fn} from public, anon`)),
        fn,
      ).toBe(true);
      expect(
        has(new RegExp(`grant execute on function public\\.${fn} to authenticated, service_role`)),
        fn,
      ).toBe(true);
    }
    for (const name of [
      "get_or_create_direct",
      "create_group",
      "add_group_members",
      "remove_group_member",
      "set_group_member_role",
      "transfer_group_ownership",
      "leave_conversation",
      "update_group_settings",
      "update_my_conversation_preferences",
      "mark_conversation_read",
      "can_use_conversation",
      "my_conversation_capability",
    ]) {
      expect(
        has(
          new RegExp(
            `create or replace function public\\.${name}\\s*\\([\\s\\S]{0,600}?security definer[\\s\\S]{0,120}?set search_path to 'public'`,
          ),
        ),
        name,
      ).toBe(true);
    }
  });
});

describe("2B — audit sumber klien", () => {
  it("tidak ada insert/update/delete langsung ke conversations/conversation_members", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      const re = /from\("(conversations|conversation_members)"\)\s*\.\s*(insert|update|delete|upsert)/g;
      if (re.test(text)) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });

  it("klien memakai RPC untuk membuat percakapan dan menyimpan preferensi", () => {
    const api = readFileSync(path.join(SRC, "lib/api/conversations.ts"), "utf8");
    expect(api).toMatch(/rpc\("get_or_create_direct"/);
    expect(api).toMatch(/rpc\("create_group"/);
    expect(api).toMatch(/rpc\("update_my_conversation_preferences"/);
    expect(api).toMatch(/rpc\("mark_conversation_read"/);
    for (const code of [
      "not_connected",
      "blocked",
      "forbidden",
      "last_owner",
      "invalid_member",
      "max_members",
      "direct_invariant",
    ]) {
      expect(api, code).toContain(code);
    }
  });

  it("daftar anggota tidak membocorkan PIN massal", () => {
    const chat = readFileSync(path.join(SRC, "lib/api/chat.ts"), "utf8");
    expect(chat).toMatch(/fetchProfileCards/);
    expect(chat).not.toMatch(/from\("profiles"\)/);
  });
});