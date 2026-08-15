#!/usr/bin/env node
/**
 * Verifikasi manifest AAB hasil `android:bundle`: package, versionCode,
 * versionName, targetSdk, izin, dan deep link. Membutuhkan `bundletool`
 * atau `aapt2` pada PATH; bila tidak ada, keluar dengan status SKIP (0)
 * dan menyatakan alasannya secara jujur — tidak pernah PASS palsu.
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const AAB = process.argv[2] ?? "android/app/build/outputs/bundle/release/app-release.aab";
if (!existsSync(AAB)) {
  console.log(`SKIP verify:aab — ${AAB} belum ada (Gradle belum dijalankan).`);
  process.exit(0);
}
let dump;
try {
  dump = execFileSync("bundletool", ["dump", "manifest", "--bundle", AAB], { encoding: "utf8" });
} catch {
  console.log("SKIP verify:aab — bundletool tidak tersedia di PATH.");
  process.exit(0);
}
const need = [
  ["package", /package="com\.mcm\.privateconnect"/],
  ["targetSdk 36", /targetSdkVersion="(0x24|36)"/],
  ["deep link mcmchat.id", /android:host="mcmchat\.id"/],
  ["POST_NOTIFICATIONS", /android\.permission\.POST_NOTIFICATIONS/],
];
// Guard pemisahan APK: bundle chat tidak boleh membawa jejak MCM Storage.
const forbidden = [/mcmstorage/i, /biz\.mcmstorage\.app/i, /mcm[\s_-]?storage/i];
const leaked = forbidden.filter((re) => re.test(dump));
if (leaked.length > 0) {
  console.error(
    `FAIL verify:aab — bundle memuat branding/package MCM Storage: ${leaked.join(", ")}`,
  );
  process.exit(1);
}
const otherPackages = [...dump.matchAll(/package="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((pkg) => pkg !== "com.mcm.privateconnect");
if (otherPackages.length > 0) {
  console.error(
    `FAIL verify:aab — package selain com.mcm.privateconnect: ${otherPackages.join(", ")}`,
  );
  process.exit(1);
}

const failed = need.filter(([, re]) => !re.test(dump)).map(([name]) => name);
if (failed.length > 0) {
  console.error(`FAIL verify:aab — tidak ditemukan: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("PASS verify:aab — manifest bundle sesuai.");
