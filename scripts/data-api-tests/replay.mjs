import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repo = path.resolve(process.argv[2] ?? new URL('../../',import.meta.url).pathname);
const label = process.argv[4] ?? path.basename(repo);
const ref = process.argv[3] ?? 'HEAD';
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
await db.waitReady;
// Minimal local compatibility fixtures only. No hosted DB connection, user data,
// GoTrue, Storage service, Realtime service, PostgREST, or GraphQL is present.
import { bootstrap } from './bootstrap.mjs';
await db.exec(bootstrap);
const filenames = ref==='WORKTREE'
 ? (await readdir(path.join(repo,'supabase/migrations'))).filter(x=>x.endsWith('.sql')).map(x=>'supabase/migrations/'+x).sort()
 : execFileSync('git',['ls-tree','-r','--name-only',ref,'supabase/migrations'],{cwd:repo,encoding:'utf8'})
 .trim().split('\n').filter(x=>x.endsWith('.sql')).sort();
const result={repo,label,ref,postgres:(await db.query('select version()')).rows[0].version,
 mode:`${ref==='WORKTREE'?'worktree SQL files':'unmodified git migration history'}; minimal local auth/storage fixtures; default table grants disabled`,
 total:filenames.length,applied:[],failure:null};
for (const filename of filenames) {
 const sql=ref==='WORKTREE'?await readFile(path.join(repo,filename),'utf8'):
  execFileSync('git',['show',`${ref}:${filename}`],{cwd:repo,encoding:'utf8'});
 try {
  await db.exec('BEGIN');
  await db.exec(sql);
  await db.exec('COMMIT');
  result.applied.push(filename);
 } catch (err) {
  await db.exec('ROLLBACK');
  result.failure={file:filename,code:err.code,message:err.message,detail:err.detail,hint:err.hint,position:err.position};
  break;
 }
}
result.tables=(await db.query(`
 SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
   pg_get_userbyid(c.relowner) AS owner
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','v','m','S','p') ORDER BY c.relname
`)).rows;
result.columns=(await db.query(`
 SELECT c.relname,a.attname,a.attacl::text FROM pg_attribute a
 JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND a.attacl IS NOT NULL ORDER BY c.relname,a.attnum
`)).rows;
result.policies=(await db.query(`
 SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
 FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname
`)).rows;
if (label==='tokolink' && !result.failure) {
 try {
  await db.exec(await readFile(path.join(repo,'supabase/tests/data-api-grants.sql'),'utf8'));
  result.catalogAssertions='passed';
 } catch(err) {
  await db.exec('ROLLBACK');
  result.catalogAssertions={code:err.code,message:err.message};
 }
 const { testTokolinkAccess } = await import('./tokolink-access.mjs');
 const forwardFile='supabase/migrations/20261023000000_initialize_variant_inventory_balance.sql';
 const forwardSql=filenames.includes(forwardFile)
  ? ref==='WORKTREE'
    ? await readFile(path.join(repo,forwardFile),'utf8')
    : execFileSync('git',['show',`${ref}:${forwardFile}`],{cwd:repo,encoding:'utf8'})
  : null;
 result.accessChecks = await testTokolinkAccess(db,{forwardSql});
}
const evidenceLabel=ref==='WORKTREE'?'patched':ref==='a6a6a576fb29d8564a37cdccfcc989abdb313e9e'?'baseline':'commit';
const output=path.join(import.meta.dirname,`${label}-${evidenceLabel}-replay.json`);
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({label,total:result.total,applied:result.applied.length,
 failure:result.failure,tables:result.tables.length,catalogAssertions:result.catalogAssertions,accessChecks:result.accessChecks?.length,output},null,2));
await db.close();
if(result.failure || (result.catalogAssertions && result.catalogAssertions!=='passed')) process.exitCode=1;
