import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `message_reactions` sengaja tidak punya policy UPDATE: mengubah reaksi
 * dilakukan dengan pola hapus-lalu-insert supaya baris tidak bisa "dipindah"
 * ke user atau pesan lain lewat UPDATE. Tes ini membuktikan invarian itu
 * secara nyata (bukan hanya membaca migrasi):
 *
 *  1. Skema: RLS aktif, tidak ada policy UPDATE, policy insert/delete terikat
 *     auth.uid().
 *  2. Integrasi live (PostgREST sebagai user login): PATCH tidak pernah
 *     mengubah baris apa pun, sementara DELETE + INSERT tetap berhasil
 *     memperbarui reaksi.
 */

const URL_BASE = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
  process.env["VITE_SUPABASE_ANON_KEY"] ??
  "";

function sessionToken(): string {
  const env = process.env["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"];
  if (env) return env;
  const file = process.env["MCM_TEST_SESSION_FILE"] ?? "/root/.cache/lovable-auth/session.json";
  if (!existsSync(file)) return "";
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { access_token?: string }).access_token ?? "";
  } catch {
    return "";
  }
}

const HAS_DB = Boolean(process.env["PGHOST"]);
const TOKEN = sessionToken();

function q(sql: string): string[] {
  return execFileSync("psql", ["-At", "-c", sql], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const db = HAS_DB ? describe : describe.skip;

db("skema message_reactions: tanpa jalur UPDATE", () => {
  it("RLS aktif dan tidak ada policy UPDATE", () => {
    expect(q(`select relrowsecurity from pg_class where oid='public.message_reactions'::regclass`)).toEqual(["t"]);
    const cmds = q(`select cmd from pg_policies where tablename='message_reactions'`);
    expect(cmds).not.toContain("UPDATE");
    expect(cmds).not.toContain("ALL");
    expect(cmds.sort()).toEqual(["DELETE", "INSERT", "SELECT"]);
  });

  it("insert & delete terikat auth.uid()", () => {
    const ins = q(
      `select coalesce(with_check,'') from pg_policies where tablename='message_reactions' and cmd='INSERT'`,
    ).join(" ");
    const del = q(
      `select coalesce(qual,'') from pg_policies where tablename='message_reactions' and cmd='DELETE'`,
    ).join(" ");
    expect(ins).toMatch(/user_id = auth\.uid\(\)/);
    expect(ins).toMatch(/current_user_can_send_conversation/);
    expect(del).toMatch(/user_id = auth\.uid\(\)/);
  });
});

// ---- Integrasi live ----
type Ctx = { messageId: string; userId: string } | null;
let ctx: Ctx = null;
const LIVE = Boolean(URL_BASE && ANON && TOKEN && HAS_DB);
const live = LIVE ? describe : describe.skip;

function headers() {
  return {
    apikey: ANON,
    authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };
}

async function rest(path: string, init: RequestInit) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: headers() });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeAll(async () => {
  if (!LIVE) return;
  const me = await fetch(`${URL_BASE}/auth/v1/user`, {
    headers: { apikey: ANON, authorization: `Bearer ${TOKEN}` },
  });
  if (!me.ok) return;
  const userId = ((await me.json()) as { id?: string }).id ?? "";
  if (!userId) return;
  // Pesan mana pun di percakapan yang diikuti user uji.
  const [messageId] = q(`
    select m.id from public.messages m
    join public.conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = '${userId}'
    order by m.created_at desc limit 1
  `);
  if (messageId) ctx = { messageId, userId };
});

afterAll(async () => {
  // Bersih-bersih lewat REST sebagai user uji: peran psql CI tidak punya DELETE.
  if (!ctx || !LIVE) return;
  for (const emoji of ["%F0%9F%91%8D", "%F0%9F%98%80"]) {
    await rest(
      `message_reactions?message_id=eq.${ctx.messageId}&user_id=eq.${ctx.userId}&emoji=eq.${emoji}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }
});

live("integrasi: UPDATE ditolak, hapus+insert berhasil", () => {
  it("PATCH tidak pernah mengubah baris reaksi milik sendiri", async () => {
    expect(ctx, "tidak ada pesan yang bisa dipakai user uji").not.toBeNull();
    const { messageId, userId } = ctx!;
    const filter = `message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}`;

    const ins = await rest("message_reactions", {
      method: "POST",
      body: JSON.stringify({ message_id: messageId, user_id: userId, emoji: "👍" }),
    });
    expect(ins.status, JSON.stringify(ins.body)).toBe(201);

    const patch = await rest(filter, { method: "PATCH", body: JSON.stringify({ emoji: "😀" }) });
    // Tanpa policy UPDATE, PostgREST tidak melihat baris apa pun untuk diubah.
    expect([200, 401, 403, 404]).toContain(patch.status);
    expect(patch.body, "UPDATE mengembalikan baris — policy UPDATE bocor").toEqual(
      patch.status === 200 ? [] : patch.body,
    );
    if (patch.status === 200) expect(patch.body).toEqual([]);

    // Nilai di DB tetap emoji lama.
    expect(
      q(
        `select emoji from public.message_reactions where message_id='${messageId}' and user_id='${userId}'`,
      ),
    ).toEqual(["👍"]);
  }, 45_000);

  it("PATCH juga tidak bisa memindahkan reaksi ke user lain", async () => {
    const { messageId, userId } = ctx!;
    const other = q(
      `select cm.user_id from public.conversation_members cm
       join public.messages m on m.conversation_id = cm.conversation_id and m.id='${messageId}'
       where cm.user_id <> '${userId}' limit 1`,
    )[0];
    if (!other) return;
    const patch = await rest(
      `message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}`,
      { method: "PATCH", body: JSON.stringify({ user_id: other }) },
    );
    if (patch.status === 200) expect(patch.body).toEqual([]);
    expect(
      q(`select count(*) from public.message_reactions where message_id='${messageId}' and user_id='${other}'`),
    ).toEqual(["0"]);
  }, 45_000);

  it("pembaruan reaksi lewat hapus-lalu-insert tetap berhasil", async () => {
    const { messageId, userId } = ctx!;
    const del = await rest(
      `message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}&emoji=eq.%F0%9F%91%8D`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);
    expect(Array.isArray(del.body) && del.body.length).toBe(1);

    const ins = await rest("message_reactions", {
      method: "POST",
      body: JSON.stringify({ message_id: messageId, user_id: userId, emoji: "😀" }),
    });
    expect(ins.status, JSON.stringify(ins.body)).toBe(201);
    expect(
      q(
        `select emoji from public.message_reactions where message_id='${messageId}' and user_id='${userId}'`,
      ),
    ).toEqual(["😀"]);

    const cleanup = await rest(
      `message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}&emoji=eq.%F0%9F%98%80`,
      { method: "DELETE" },
    );
    expect(cleanup.status).toBe(200);
  }, 45_000);
});
