import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard pemisahan APK: repo ini hanya membangun aplikasi chat privat
 * `com.mcm.privateconnect`. Tidak ada package, branding, atau artifact
 * MCM STORAGE yang boleh ikut.
 */
const root = process.cwd();
const read = (p: string) => readFileSync(path.resolve(root, p), "utf8");

const APP_ID = "com.mcm.privateconnect";
const gradle = read("android/app/build.gradle");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const strings = read("android/app/src/main/res/values/strings.xml");
const capacitor = read("capacitor.config.ts");
const workflow = read(".github/workflows/android-release.yml");
const verifyAab = read("scripts/verify-aab.mjs");
const pkg = read("package.json");

describe("identitas aplikasi tunggal", () => {
  it("applicationId tetap com.mcm.privateconnect", () => {
    expect(gradle).toContain(`applicationId "${APP_ID}"`);
    expect(gradle.match(/applicationId\s+"[^"]+"/g)).toHaveLength(1);
    expect(capacitor).toContain(`appId: "${APP_ID}"`);
    expect(strings).toContain(APP_ID);
  });

  it("tidak ada flavor atau suffix yang menghasilkan APK kedua", () => {
    expect(gradle).not.toMatch(/applicationIdSuffix/);
    expect(gradle).not.toMatch(/productFlavors/);
  });

  it("manifest hanya memakai domain chat", () => {
    expect(manifest).toMatch(/mcmchat\.(id|lovable\.app)/);
    expect(manifest).not.toMatch(/mcmstorage/i);
  });
});

describe("tidak ada jejak MCM Storage", () => {
  it("verify:identity lulus di seluruh repo", () => {
    const out = execFileSync("node", ["scripts/verify-app-identity.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toMatch(/PASS verify:identity/);
  });

  it("verifikasi AAB menolak package lain dan branding MCM Storage", () => {
    expect(verifyAab).toMatch(/mcmstorage/i);
    expect(verifyAab).toMatch(/package selain com\.mcm\.privateconnect/);
  });

  it("workflow rilis menjalankan guard sebelum build", () => {
    expect(workflow).toMatch(/verify:identity/);
    expect(workflow.indexOf("verify:identity")).toBeLessThan(workflow.indexOf("bundleRelease"));
    expect(workflow).toMatch(/verify:aab/);
    expect(workflow).not.toMatch(/mcmstorage/i);
  });

  it("script guard terdaftar di package.json", () => {
    expect(pkg).toMatch(/"verify:identity":\s*"node scripts\/verify-app-identity\.mjs"/);
  });
});
