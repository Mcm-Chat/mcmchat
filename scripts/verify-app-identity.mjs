#!/usr/bin/env node
/**
 * Guard pemisahan APK: project ini HANYA membangun aplikasi chat privat
 * `com.mcm.privateconnect`. Tidak boleh ada package, branding, atau artifact
 * MCM STORAGE yang ikut ter-build dari repo ini.
 *
 * Dijalankan di CI sebelum build; gagal = rilis dibatalkan.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP_ID = "com.mcm.privateconnect";
const FORBIDDEN = [
  /mcmstorage/i,
  /biz\.mcmstorage\.app/i,
  /mcm[\s_-]?storage/i,
  /b29d53bc-658a-4d86-8c6c-32fdd495b32b/i,
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".output",
  ".vinxi",
  ".nitro",
  "capacitor/www",
  ".lovable",
  "android/.gradle",
  "android/build",
]);
const SELF = path.resolve("scripts/verify-app-identity.mjs");
const SELF_TEST = path.resolve("src/lib/security/__tests__/apk-separation.test.ts");
// File yang memang MENJELASKAN atau MENEGAKKAN larangan ini boleh menyebut namanya.
const ALLOW = new Set([
  SELF,
  SELF_TEST,
  path.resolve("docs/app-identity.md"),
  path.resolve("scripts/verify-aab.mjs"),
]);

const errors = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(process.cwd(), full).replace(/\\/g, "/");
    if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (st.size > 2_000_000) continue;
    if (/\.(png|jpe?g|webp|ico|jks|keystore|aab|apk|zip|jar|woff2?)$/i.test(entry)) continue;
    if (ALLOW.has(full)) continue;
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const re of FORBIDDEN) {
      if (re.test(text)) errors.push(`${rel}: menyebut MCM Storage (${re})`);
    }
  }
}
walk(process.cwd());

function mustContain(file, re, label) {
  if (!existsSync(file)) return errors.push(`${file} hilang`);
  if (!re.test(readFileSync(file, "utf8"))) errors.push(`${file}: ${label}`);
}

mustContain(
  "capacitor.config.ts",
  new RegExp(`appId:\\s*"${APP_ID.replace(/\./g, "\\.")}"`),
  "appId harus com.mcm.privateconnect",
);
mustContain(
  "android/app/build.gradle",
  new RegExp(`applicationId "${APP_ID.replace(/\./g, "\\.")}"`),
  "applicationId harus com.mcm.privateconnect",
);
mustContain(
  "android/app/src/main/res/values/strings.xml",
  new RegExp(APP_ID.replace(/\./g, "\\.")),
  "package_name harus com.mcm.privateconnect",
);

// Tidak boleh ada applicationId / applicationIdSuffix kedua (satu build = satu APK chat).
if (existsSync("android/app/build.gradle")) {
  const gradle = readFileSync("android/app/build.gradle", "utf8");
  const ids = gradle.match(/applicationId\s+"[^"]+"/g) ?? [];
  if (ids.length !== 1)
    errors.push(`android/app/build.gradle: ditemukan ${ids.length} applicationId`);
  if (/applicationIdSuffix/.test(gradle))
    errors.push("android/app/build.gradle: applicationIdSuffix tidak diizinkan");
  if (/productFlavors/.test(gradle))
    errors.push("android/app/build.gradle: productFlavors tidak diizinkan (satu produk saja)");
}

if (errors.length > 0) {
  console.error("FAIL verify:identity — guard pemisahan APK:");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`PASS verify:identity — repo hanya membangun ${APP_ID}, tanpa jejak MCM Storage.`);
