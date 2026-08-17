#!/usr/bin/env node
/**
 * Verifikasi kredensial DB (PG*) + Data API yang dibutuhkan gate keamanan.
 *
 * Dijalankan di CI sebelum tes PIN agar kegagalan karena secret yang belum
 * diset memberi pesan jelas (nama secret + cara memperbaikinya), bukan error
 * koneksi Postgres yang membingungkan.
 *
 * Nilai secret TIDAK PERNAH dicetak — hanya status ada/tidak ada.
 */

/** @type {{ name: string; hint: string; required: boolean }[]} */
const VARS = [
  { name: "PGHOST", hint: "host database (mis. db.<ref>.supabase.co)", required: true },
  { name: "PGPORT", hint: "port database (biasanya 5432)", required: true },
  { name: "PGUSER", hint: "user database untuk uji privilege", required: true },
  { name: "PGPASSWORD", hint: "password user database", required: true },
  { name: "PGDATABASE", hint: "nama database (biasanya postgres)", required: true },
  { name: "SUPABASE_URL", hint: "URL Data API untuk uji respons REST", required: true },
  {
    name: "SUPABASE_PUBLISHABLE_KEY",
    hint: "kunci publishable/anon untuk uji akses peran anon",
    required: true,
  },
];

const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const missing = VARS.filter((v) => v.required && blank(process.env[v.name]));
const present = VARS.filter((v) => !blank(process.env[v.name]));

for (const v of present) console.log(`OK      ${v.name} tersedia`);

if (missing.length === 0) {
  const port = process.env["PGPORT"];
  if (port && !/^\d+$/.test(port.trim())) {
    console.error(`\nGAGAL: PGPORT harus berupa angka, bukan "${port}".`);
    process.exit(1);
  }
  console.log("\nSemua secret database/Data API tersedia.");
  process.exit(0);
}

console.error(`\nGAGAL: ${missing.length} secret belum diset pada repository ini.\n`);
for (const v of missing) console.error(`  - ${v.name}  → ${v.hint}`);
console.error(
  [
    "",
    "Cara memperbaiki:",
    "  1. Buka GitHub repo → Settings → Secrets and variables → Actions.",
    "  2. Tambahkan setiap secret di atas dengan nama PERSIS seperti tertulis.",
    "  3. Pastikan job di .github/workflows/ci.yml memetakannya ke env,",
    "     mis. PGHOST: ${{ secrets.PGHOST }} (secret tidak otomatis jadi env).",
    "  4. Jalankan ulang workflow.",
    "",
    "Catatan: untuk PR dari fork, secret tidak diberikan oleh GitHub —",
    "jalankan gate ini dari branch di repo utama.",
  ].join("\n"),
);
process.exit(1);
