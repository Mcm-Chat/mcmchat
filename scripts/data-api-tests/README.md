# Isolated PostgreSQL migration and role tests

Uses real PostgreSQL 18.6 through exactly pinned `@electric-sql/pglite` 0.5.11.
No hosted connection, production credential, or production data is used.

```sh
npm ci --prefix scripts/data-api-tests
node scripts/data-api-tests/replay.mjs "$PWD" HEAD tokolink
```

Use `WORKTREE` for current uncommitted migrations. To replay the original audit
baseline, use commit `a6a6a576fb29d8564a37cdccfcc989abdb313e9e`.
The emitted JSON contains source mode, files, first SQL failure, catalogs and
synthetic GRANT/RLS checks. Checks include cross-user/tenant isolation, secret
column denial, forbidden direct stock writes, zero-inventory initialization,
parent-product business validation, trigger access, unchanged existing stock,
and idempotent call-hide/status-view/status-mute inserts without UPDATE grants.

`bootstrap.mjs` supplies minimal `auth.users`, JWT helpers, Storage tables/path
helpers, Supabase-shaped roles, and a Realtime publication. pgcrypto is real.
Default table privileges are absent. This tests migration SQL and PostgreSQL
role/RLS behavior; it is not a full Supabase, Auth, Storage, Realtime, PostgREST
or GraphQL service, and does not verify authenticated HTTP API access.
