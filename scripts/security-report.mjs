#!/usr/bin/env node
/**
 * Security scan untuk CI/CD.
 *
 * 1. Menjalankan seluruh suite invariant keamanan (src/lib/security/__tests__)
 *    dan merekam hasilnya per test file.
 * 2. Menghitung sidik jari skema/policy dari supabase/migrations (jumlah
 *    policy, grant/revoke, fungsi SECURITY DEFINER, tabel dengan RLS aktif).
 * 3. Membandingkan sidik jari itu dengan baseline yang di-commit
 *    (security/baseline.json) agar perubahan skema atau policy langsung
 *    terlihat pada build tersebut.
 * 4. Menyimpan laporan per build ke security-report/ (JSON + Markdown).
 *
 * Keluar dengan kode 1 bila ada tes keamanan gagal. Drift skema/policy
 * dilaporkan (dan ditandai) tanpa menggagalkan build, kecuali --strict-drift.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, process.env["SECURITY_REPORT_DIR"] ?? "security-report");
const BASELINE = path.join(ROOT, "security", "baseline.json");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const args = process.argv.slice(2);
const UPDATE_BASELINE = args.includes("--update-baseline");
const STRICT_DRIFT = args.includes("--strict-drift");

const sha = (s) => createHash("sha256").update(s).digest("hex");

function runSecurityTests() {
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "vitest-security.json");
  let failed = false;
  try {
    execFileSync(
      "bunx",
      ["vitest", "run", "src/lib/security/__tests__", "--reporter=json", `--outputFile=${jsonPath}`],
      { stdio: ["ignore", "inherit", "inherit"], cwd: ROOT },
    );
  } catch {
    failed = true;
  }
  if (!existsSync(jsonPath)) {
    return { failed: true, total: 0, passed: 0, failures: [], files: [], error: "vitest tidak menghasilkan laporan" };
  }
  const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
  const files = [];
  const failures = [];
  let total = 0;
  let passed = 0;
  for (const suite of raw.testResults ?? []) {
    const rel = path.relative(ROOT, suite.name ?? "");
    let ok = 0;
    let bad = 0;
    for (const t of suite.assertionResults ?? []) {
      total += 1;
      if (t.status === "passed") { passed += 1; ok += 1; }
      else {
        bad += 1;
        failures.push({ file: rel, title: t.fullName ?? t.title, message: (t.failureMessages ?? []).join("\n").slice(0, 800) });
      }
    }
    files.push({ file: rel, passed: ok, failed: bad });
  }
  return { failed: failed || failures.length > 0, total, passed, failures, files };
}

function migrationFingerprint() {
  const names = existsSync(MIGRATIONS)
    ? readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
    : [];
  const perFile = names.map((f) => ({
    file: f,
    sha256: sha(readFileSync(path.join(MIGRATIONS, f), "utf8")),
  }));
  const sql = names
    .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const count = (re) => (sql.match(re) ?? []).length;
  const uniq = (re, group = 1) => {
    const out = new Set();
    const g = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
    let m;
    while ((m = g.exec(sql)) !== null) out.add(m[group]);
    return [...out].sort();
  };
  return {
    migrations: perFile,
    combinedSha256: sha(sql),
    stats: {
      migrationFiles: names.length,
      createPolicy: count(/create policy /g),
      dropPolicy: count(/drop policy /g),
      grant: count(/\bgrant /g),
      revoke: count(/\brevoke /g),
      securityDefiner: count(/security definer/g),
      enableRls: count(/enable row level security/g),
    },
    rlsTables: uniq(/alter table (?:only )?public\.([a-z0-9_]+) enable row level security/),
    definerFunctions: uniq(/create or replace function public\.([a-z0-9_]+)\s*\([^;]*?security definer/),
  };
}

function diffFingerprint(prev, next) {
  if (!prev) return { baseline: "absent", changed: false, notes: ["Baseline belum ada — laporan ini menjadi baseline pertama."] };
  const notes = [];
  const prevFiles = new Map((prev.migrations ?? []).map((m) => [m.file, m.sha256]));
  const nextFiles = new Map((next.migrations ?? []).map((m) => [m.file, m.sha256]));
  const added = [...nextFiles.keys()].filter((f) => !prevFiles.has(f));
  const removed = [...prevFiles.keys()].filter((f) => !nextFiles.has(f));
  const modified = [...nextFiles.keys()].filter((f) => prevFiles.has(f) && prevFiles.get(f) !== nextFiles.get(f));
  if (added.length) notes.push(`Migration baru: ${added.join(", ")}`);
  if (removed.length) notes.push(`Migration hilang: ${removed.join(", ")}`);
  if (modified.length) notes.push(`Migration berubah isi (harusnya immutable): ${modified.join(", ")}`);
  for (const [k, v] of Object.entries(next.stats)) {
    const before = prev.stats?.[k];
    if (before !== undefined && before !== v) notes.push(`stats.${k}: ${before} → ${v}`);
  }
  const setDiff = (a = [], b = [], label) => {
    const plus = b.filter((x) => !a.includes(x));
    const minus = a.filter((x) => !b.includes(x));
    if (plus.length) notes.push(`${label} bertambah: ${plus.join(", ")}`);
    if (minus.length) notes.push(`${label} hilang: ${minus.join(", ")}`);
  };
  setDiff(prev.rlsTables, next.rlsTables, "Tabel RLS");
  setDiff(prev.definerFunctions, next.definerFunctions, "Fungsi SECURITY DEFINER");
  return {
    baseline: "present",
    changed: notes.length > 0 || prev.combinedSha256 !== next.combinedSha256,
    removedMigrations: removed,
    modifiedMigrations: modified,
    addedMigrations: added,
    notes,
  };
}

function markdown(report) {
  const t = report.tests;
  const d = report.drift;
  const lines = [
    `# Laporan keamanan build`,
    ``,
    `- Commit: \`${report.commit}\``,
    `- Waktu: ${report.generatedAt}`,
    `- Status: **${report.status}**`,
    ``,
    `## Invariant keamanan`,
    ``,
    `Tes: ${t.passed}/${t.total} lulus, ${t.failures.length} gagal.`,
    ``,
    `| Berkas | Lulus | Gagal |`,
    `| --- | ---: | ---: |`,
    ...t.files.map((f) => `| ${f.file} | ${f.passed} | ${f.failed} |`),
  ];
  if (t.failures.length) {
    lines.push(``, `### Kegagalan`, ``);
    for (const f of t.failures) lines.push(`- **${f.title}** (${f.file})`);
  }
  lines.push(
    ``,
    `## Skema & policy`,
    ``,
    `| Metrik | Nilai |`,
    `| --- | ---: |`,
    ...Object.entries(report.fingerprint.stats).map(([k, v]) => `| ${k} | ${v} |`),
    ``,
    `Sidik jari gabungan: \`${report.fingerprint.combinedSha256.slice(0, 16)}\``,
    ``,
    `## Drift terhadap baseline`,
    ``,
    d.changed ? `Terdeteksi perubahan:` : `Tidak ada perubahan skema/policy terhadap baseline.`,
    ...(d.notes ?? []).map((n) => `- ${n}`),
  );
  return lines.join("\n") + "\n";
}

const tests = runSecurityTests();
const fingerprint = migrationFingerprint();
const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
const drift = diffFingerprint(prev, fingerprint);
const hardDrift = drift.modifiedMigrations?.length || drift.removedMigrations?.length;

const report = {
  generatedAt: new Date().toISOString(),
  commit: process.env["GITHUB_SHA"] ?? "local",
  ref: process.env["GITHUB_REF"] ?? "local",
  runId: process.env["GITHUB_RUN_ID"] ?? null,
  status: tests.failed ? "FAIL" : hardDrift ? "REVIEW" : drift.changed ? "CHANGED" : "OK",
  tests,
  fingerprint,
  drift,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "security-report.json"), JSON.stringify(report, null, 2));
const md = markdown(report);
writeFileSync(path.join(OUT_DIR, "security-report.md"), md);
if (process.env["GITHUB_STEP_SUMMARY"]) {
  writeFileSync(process.env["GITHUB_STEP_SUMMARY"], md, { flag: "a" });
}

if (UPDATE_BASELINE) {
  mkdirSync(path.dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(fingerprint, null, 2));
  console.log(`Baseline diperbarui: ${path.relative(ROOT, BASELINE)}`);
}

console.log(md);
if (tests.failed) process.exit(1);
if (STRICT_DRIFT && drift.changed) {
  console.error("Drift skema/policy terdeteksi dan --strict-drift aktif.");
  process.exit(2);
}
