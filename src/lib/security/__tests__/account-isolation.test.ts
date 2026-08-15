import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  __resetSessionScope,
  getActiveUserId,
  purgeLocalScope,
  scopedKey,
  setActiveUser,
  onAccountSwitch,
} from "@/lib/session-scope";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function srcFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name) && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

function migrationsSql(): string {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

describe("ruang lingkup data per akun", () => {
  beforeEach(() => {
    __resetSessionScope();
    localStorage.clear();
  });
  afterEach(() => __resetSessionScope());

  it("key sensitif selalu ter-namespace dengan userId", () => {
    setActiveUser(A);
    expect(scopedKey("draft:conv-1")).toBe(`mcm:${A}:draft:conv-1`);
    setActiveUser(B);
    expect(scopedKey("draft:conv-1")).toBe(`mcm:${B}:draft:conv-1`);
  });

  it("pergantian akun menghapus data lokal akun lama, bukan akun baru", () => {
    setActiveUser(A);
    localStorage.setItem(scopedKey("draft:c1"), "rahasia A");
    localStorage.setItem("mcm-prep-tokens", "{legacy}");
    setActiveUser(B);
    localStorage.setItem(scopedKey("draft:c1"), "punya B");
    expect(localStorage.getItem(`mcm:${A}:draft:c1`)).toBeNull();
    expect(localStorage.getItem("mcm-prep-tokens")).toBeNull();
    expect(localStorage.getItem(`mcm:${B}:draft:c1`)).toBe("punya B");
  });

  it("logout membuang data akun aktif dan mengosongkan identitas", () => {
    setActiveUser(A);
    localStorage.setItem(scopedKey("draft:c1"), "rahasia A");
    setActiveUser(null);
    expect(getActiveUserId()).toBeNull();
    expect(localStorage.getItem(`mcm:${A}:draft:c1`)).toBeNull();
  });

  it("listener pergantian akun dipanggil sekali per perubahan identitas", () => {
    const seen = vi.fn();
    onAccountSwitch(seen);
    setActiveUser(A);
    setActiveUser(A);
    setActiveUser(B);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenLastCalledWith(B, A);
  });

  it("purge tidak menyentuh preferensi perangkat non-sensitif", () => {
    localStorage.setItem("mcm-theme", "dark");
    localStorage.setItem("mcm-onboarded", "1");
    setActiveUser(A);
    purgeLocalScope(A);
    expect(localStorage.getItem("mcm-theme")).toBe("dark");
    expect(localStorage.getItem("mcm-onboarded")).toBe("1");
  });
});

describe("audit statis media & penyimpanan", () => {
  const files = srcFiles();

  it("tidak ada getPublicUrl di seluruh kode", () => {
    const bad = files.filter((f) => readFileSync(f, "utf8").includes("getPublicUrl"));
    expect(bad).toEqual([]);
  });

  it("tidak ada key localStorage sensitif tanpa namespace akun", () => {
    const allowed = /"(mcm-theme|mcm-onboarded)"/;
    const bad: string[] = [];
    for (const f of files) {
      // theme.tsx hanya menyimpan preferensi tema perangkat (non-sensitif).
      if (
        f.endsWith("session-scope.ts") ||
        f.endsWith("theme.tsx") ||
        f.includes("integrations/supabase")
      )
        continue;
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/localStorage\.(get|set|remove)Item\((.+?)[,)]/);
        if (!m) continue;
        const arg = m[2] ?? "";
        if (
          allowed.test(arg) ||
          arg.includes("Key") ||
          arg.includes("scopedKey") ||
          arg.includes("`mcm:${")
        )
          continue;
        bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("outbox tersimpan per akun", () => {
    const store = readFileSync("src/lib/api/outbox-store.ts", "utf8");
    expect(store).toContain("mcm:${userId}:outbox.v1");
    expect(store).toContain("e.senderId === userId");
  });

  it("cache signed URL dan avatar dikunci pada akun aktif", () => {
    expect(readFileSync("src/lib/api/storage.ts", "utf8")).toContain("getActiveUserId");
    expect(readFileSync("src/lib/api/avatar.ts", "utf8")).toContain("getActiveUserId");
  });

  it("cache query, realtime, dan outbox dibersihkan saat akun berganti", () => {
    const auth = readFileSync("src/lib/auth.tsx", "utf8");
    expect(auth).toContain("setActiveUser");
    expect(auth).toContain("removeAllChannels");
    expect(auth).toContain("resetOutboxForAccount");
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toContain("onAccountSwitch");
  });
});

describe("invarian isolasi database", () => {
  const sql = migrationsSql();

  it("buku kontak hanya bisa dibaca pemiliknya", () => {
    const policy = sql.slice(sql.lastIndexOf('CREATE POLICY "own contacts read"'));
    const body = policy.slice(0, policy.indexOf(";"));
    expect(body).toContain("owner_id = auth.uid()");
    expect(body).not.toContain("contact_id = auth.uid()");
  });

  it("status blokir dua arah lewat fungsi database, bukan tabel kontak", () => {
    expect(sql).toContain("FUNCTION public.blocked_between");
    expect(readFileSync("src/lib/api/contacts.ts", "utf8")).toContain('rpc("blocked_between"');
  });

  it("tidak ada self-join ke percakapan", () => {
    const idx = sql.lastIndexOf('CREATE POLICY "member adds members"');
    const body = sql.slice(idx, sql.indexOf(";", idx));
    expect(body).not.toMatch(/user_id = auth\.uid\(\)/);
    expect(body).toContain("is_conv_member(conversation_id, auth.uid())");
  });

  it("peserta panggilan hanya ditambahkan pemanggil", () => {
    const idx = sql.lastIndexOf('CREATE POLICY "add participant"');
    const body = sql.slice(idx, sql.indexOf(";", idx));
    expect(body).toContain("c.initiator_id = auth.uid()");
    expect(body).toContain("is_conv_member(c.conversation_id, call_participants.user_id)");
  });

  it("tidak ada bucket publik di migrasi", () => {
    expect(sql).not.toMatch(/insert\s+into\s+storage\.buckets[\s\S]{0,200}true/i);
  });
});
