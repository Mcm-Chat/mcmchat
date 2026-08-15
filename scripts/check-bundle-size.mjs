#!/usr/bin/env node
/**
 * Gate ukuran bundel klien.
 *
 * Mengukur aset di dist/client dalam byte gzip (angka yang benar-benar
 * diunduh pengguna di jaringan seluler) lalu membandingkannya dengan
 * anggaran di bundle-budget.json. Keluar dengan kode 1 bila terlampaui,
 * supaya regresi performa ketahuan di CI, bukan di perangkat pengguna.
 *
 * Pakai: node scripts/check-bundle-size.mjs [dir=dist/client]
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || "dist/client";
const KIB = 1024;
const budgetFile = JSON.parse(readFileSync("bundle-budget.json", "utf8"));
const { budgets, chunkOverrides = {} } = budgetFile;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

try {
  statSync(ROOT);
} catch {
  console.error(`Direktori build tidak ditemukan: ${ROOT}. Jalankan "bun run build:web" dulu.`);
  process.exit(1);
}

const files = walk(ROOT).map((file) => {
  const raw = readFileSync(file);
  return {
    file: path.relative(ROOT, file),
    raw: raw.length,
    gzip: gzipSync(raw).length,
    ext: path.extname(file),
  };
});

const sum = (pred) => files.filter(pred).reduce((n, f) => n + f.gzip, 0);
const kib = (bytes) => bytes / KIB;
const fmt = (bytes) => `${kib(bytes).toFixed(1)} KiB`;

// Nama chunk tanpa hash: "assets/chat._id-DXlRpNfX.js" -> "chat._id"
const chunkName = (file) =>
  path.basename(file).replace(/-[A-Za-z0-9_-]{8,}\.(js|css)$/, "").replace(/\.(js|css)$/, "");

const totals = {
  totalClient: sum(() => true),
  totalJs: sum((f) => f.ext === ".js"),
  totalCss: sum((f) => f.ext === ".css"),
};

const jsFiles = files.filter((f) => f.ext === ".js").sort((a, b) => b.gzip - a.gzip);
const failures = [];

for (const [key, limitKib] of Object.entries(budgets)) {
  if (key === "largestChunk") continue;
  const actual = totals[key];
  if (actual === undefined) continue;
  if (kib(actual) > limitKib) {
    failures.push(`${key}: ${fmt(actual)} > anggaran ${limitKib} KiB`);
  }
}

for (const f of jsFiles) {
  const name = chunkName(f.file);
  const limitKib = chunkOverrides[name] ?? budgets.largestChunk;
  if (kib(f.gzip) > limitKib) {
    failures.push(`chunk ${name}: ${fmt(f.gzip)} > anggaran ${limitKib} KiB`);
  }
}

const lines = [
  "| Metrik | Gzip | Anggaran |",
  "| --- | ---: | ---: |",
  `| Total klien | ${fmt(totals.totalClient)} | ${budgets.totalClient} KiB |`,
  `| Total JS | ${fmt(totals.totalJs)} | ${budgets.totalJs} KiB |`,
  `| Total CSS | ${fmt(totals.totalCss)} | ${budgets.totalCss} KiB |`,
  "",
  "10 chunk JS terbesar (gzip):",
  "",
  "| Chunk | Gzip | Mentah |",
  "| --- | ---: | ---: |",
  ...jsFiles.slice(0, 10).map((f) => `| ${f.file} | ${fmt(f.gzip)} | ${fmt(f.raw)} |`),
];

console.log(lines.join("\n"));

const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary) {
  appendFileSync(summary, `### Ukuran bundel klien\n\n${lines.join("\n")}\n\n`);
  if (failures.length) {
    appendFileSync(summary, `**Anggaran terlampaui:**\n\n${failures.map((f) => `- ${f}`).join("\n")}\n`);
  }
}

if (failures.length) {
  console.error("\nAnggaran bundel terlampaui:");
  for (const f of failures) console.error(` - ${f}`);
  console.error("\nPerkecil bundel (lazy-load / code-split) atau naikkan angka di bundle-budget.json secara sadar.");
  process.exit(1);
}

console.log("\nSemua anggaran bundel terpenuhi.");
