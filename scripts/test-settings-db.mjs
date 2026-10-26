/**
 * Isolated SQL regression test; never connects to Supabase or production data.
 * Install the pinned test runtime outside the app:
 *   npm install --prefix /tmp/tokolink-db-test --no-package-lock @electric-sql/pglite@0.5.12
 *   TOKOLINK_PGLITE_MODULE=/tmp/tokolink-db-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-settings-db.mjs
 * PGlite executes real PostgreSQL SQL/RLS, but serializes queries in one process;
 * independent-session lock contention still requires a PostgreSQL integration run.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.TOKOLINK_PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const initial = await readFile(
  new URL(
    "../supabase/migrations/20260812123533_af51dd56-f395-44ba-83ea-d6adc3db7071.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = initial.slice(
  initial.indexOf("create table public.user_settings"),
  initial.indexOf("-- new user bootstrap"),
);
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
`);
await db.exec(schema);
await db.exec(
  await readFile(
    new URL(
      "../supabase/migrations/20260812134905_772d4d6f-e709-4e0e-b196-d6ce09c06e55.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261026180002_atomic_user_settings.sql", import.meta.url),
    "utf8",
  ),
);
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
await db.query("insert into auth.users (id) values ($1), ($2)", [userA, userB]);
await db.query(
  `insert into public.user_settings(user_id, notifications, voice) values ($1, '{"chat":true,"sound":true,"futureCategory":true}', '{"enabled":false,"custom":{"pitch":1,"gain":2},"futureVoice":"keep"}')`,
  [userA],
);
const use = async (userId, role = "authenticated") => {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(`set role ${role}`);
};
const patch = async (userId, data) =>
  (
    await db.query("select * from public.update_my_settings($1::uuid, $2::jsonb)", [
      userId,
      JSON.stringify(data),
    ])
  ).rows[0];
let checks = 0;
const check = (value, expected) => {
  assert.deepEqual(value, expected);
  checks++;
};
await use(userA);
// Both devices began with the same old settings. They send only their changed keys.
await patch(userA, { notifications: { chat: false } });
let saved = await patch(userA, { notifications: { sound: false } });
check(saved.notifications, { chat: false, sound: false, futureCategory: true });
await patch(userA, { voice: { custom: { pitch: -2 } } });
saved = await patch(userA, { voice: { custom: { gain: 5 }, intensity: 0.2 } });
check(saved.voice, {
  enabled: false,
  custom: { pitch: -2, gain: 5 },
  intensity: 0.2,
  futureVoice: "keep",
});
saved = await patch(userA, { theme: "light", privacy: { online: false } });
check(saved.theme, "light");
check(saved.privacy.online, false);
check(saved.privacy.lastSeen, "kontak");
check(saved.user_id, userA);
const beforeInvalid = saved;
for (const invalid of [
  null,
  [],
  { user_id: userB },
  { theme: null },
  { theme: "system" },
  { notifications: null },
  { notifications: { push: "false" } },
  { notifications: { unknown: true } },
  { privacy: { online: 1 } },
  { security: { twoFactor: "true" } },
  { voice: { preset: null } },
  { voice: { preset: "someone" } },
  { voice: { enabled: 1 } },
  { voice: { intensity: 2 } },
  { voice: { custom: null } },
  { voice: { custom: { pitch: 6 } } },
  { voice: { custom: { gain: "1" } } },
]) {
  await assert.rejects(() => patch(userA, invalid));
  checks++;
}
check((await db.query("select * from public.user_settings")).rows[0], beforeInvalid);
await assert.rejects(() => patch(userB, { theme: "dark" }));
checks++;
await use(userB);
check((await db.query("select user_id from public.user_settings")).rows, []);
saved = await patch(userB, { notifications: { push: false } });
check(saved.user_id, userB);
check(saved.notifications.push, false);
check(
  (
    await db.query(
      "update public.user_settings set theme = $1 where user_id = $2 returning user_id",
      ["dark", userA],
    )
  ).rows,
  [],
);
await use(userA);
check((await db.query("select theme from public.user_settings")).rows, [{ theme: "light" }]);
await use(null);
await assert.rejects(() => patch(userA, { theme: "dark" }));
checks++;
await use(userA, "anon");
await assert.rejects(() => patch(userA, { theme: "dark" }), /permission denied/);
checks++;
await db.exec("reset role");
const functionMeta = (
  await db.query(
    `select prosecdef, proconfig from pg_proc where oid = 'public.update_my_settings(uuid,jsonb)'::regprocedure`,
  )
).rows[0];
check(functionMeta.prosecdef, false);
check(functionMeta.proconfig, ['search_path=""']);

// Exercise the refresh RPC against the same closed devices table as the app.
await db.exec(
  initial.slice(
    initial.indexOf("create table public.devices"),
    initial.indexOf("-- ============ CONTACTS"),
  ),
);
const pushColumns = await readFile(
  new URL(
    "../supabase/migrations/20260812134028_88c5be26-d834-4380-85cf-6f33b80001a4.sql",
    import.meta.url,
  ),
  "utf8",
);
await db.exec(
  pushColumns.slice(
    pushColumns.indexOf("ALTER TABLE public.devices"),
    pushColumns.indexOf("CREATE UNIQUE INDEX"),
  ),
);
await db.exec(`
  alter table public.devices add column installation_id text;
  alter table public.devices drop column action_token_hash, drop column action_token_prefix;
  create unique index devices_user_installation_key on public.devices(user_id,installation_id) where installation_id is not null;
  revoke all on public.devices from public, anon, authenticated;
  drop policy "own devices" on public.devices;
`);
await db.exec(
  await readFile(
    new URL(
      "../supabase/migrations/20261026180357_push_refresh_preserves_revocation.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const registerSource = await readFile(
  new URL(
    "../supabase/migrations/20260814101750_1a448442-cd41-48ca-b2b0-541db4333be4.sql",
    import.meta.url,
  ),
  "utf8",
);
await db.exec(
  registerSource.slice(
    registerSource.indexOf("CREATE FUNCTION public.register_push_device"),
    registerSource.indexOf("-- 4)"),
  ),
);
await db.query(
  `insert into public.devices(user_id,installation_id,name,push_token,revoked_at) values
  ($1,'active-installation','Phone A','initial-token-a',null),
  ($1,'revoked-installation','Revoked A',null,now()),
  ($2,'other-installation','Phone B','existing-token-b',null)`,
  [userA, userB],
);
const refreshToken = async (installation, token) =>
  (
    await db.query("select public.refresh_my_push_device($1,$2) as refreshed", [
      installation,
      token,
    ])
  ).rows[0].refreshed;
await use(userA);
check(await refreshToken("active-installation", "rotated-token-a"), true);
check(await refreshToken("revoked-installation", "must-not-reactivate"), false);
check(await refreshToken("other-installation", "must-not-update-b"), false);
check(await refreshToken("new-installation", "must-not-insert"), false);
check(await refreshToken("active-installation", "existing-token-b"), false);
await assert.rejects(() => db.query("select * from public.devices"), /permission denied/);
checks++;
await db.exec("reset role");
check((await db.query("select count(*)::int as total from public.devices")).rows[0].total, 3);
check(
  (
    await db.query(
      "select push_token,revoked_at is not null as revoked from public.devices where installation_id='revoked-installation'",
    )
  ).rows[0],
  { push_token: null, revoked: true },
);
check(
  (
    await db.query(
      "select push_token from public.devices where installation_id='active-installation'",
    )
  ).rows[0].push_token,
  "rotated-token-a",
);
check(
  (
    await db.query(
      "select push_token from public.devices where installation_id='other-installation'",
    )
  ).rows[0].push_token,
  "existing-token-b",
);
await use(userA);
await db.query("select public.register_push_device($1,$2,$3,$4,$5)", [
  "revoked-installation",
  "Phone A",
  "android",
  "explicit-opt-in-token",
  "1.0",
]);
check(await refreshToken("revoked-installation", "after-opt-in-token"), true);
await use(null);
await assert.rejects(() => refreshToken("active-installation", "unauth-token"));
checks++;
await use(userA, "anon");
await assert.rejects(
  () => refreshToken("active-installation", "anonymous-token"),
  /permission denied/,
);
checks++;
await db.close();
console.log(
  `Settings SQL: ${checks} checks passed (PGlite, isolated PostgreSQL semantics; cross-session contention unverified).`,
);
