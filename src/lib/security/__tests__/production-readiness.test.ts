import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("kejujuran dokumentasi produksi", () => {
  it("README tidak lagi mengklaim MVP localStorage atau panggilan simulasi", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/tersimpan di localStorage/i);
    expect(readme).not.toMatch(/Simulasi MVP/i);
    expect(readme).not.toMatch(/mode demo/i);
  });

  it("README tidak mengklaim E2EE atau tidak dapat dilacak", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/Bukan\*\* end-to-end encrypted/i);
    expect(readme).not.toMatch(/tidak dapat dilacak\b(?!")/i);
  });

  it("matriks kesiapan produksi ada dan memuat semua modul wajib", () => {
    const doc = read("PRODUCTION_READINESS.md");
    for (const modul of [
      "Auth",
      "PIN",
      "Chat realtime",
      "Receipts",
      "Outbox",
      "Attachment",
      "Avatar",
      "Status",
      "Grup",
      "Panggilan",
      "Push",
      "Katalog",
      "Penjualan",
      "Penyiapan",
      "Ledger",
      "Peran bisnis",
      "Hapus akun",
      "Privasi",
      "Rilis Android",
      "Domain",
      "Observability",
      "Billing",
    ]) {
      expect(doc).toContain(modul);
    }
  });
});

describe("gate rilis Android", () => {
  it("compileSdk dan targetSdk = 36", () => {
    const gradle = read("android/variables.gradle");
    expect(gradle).toMatch(/compileSdkVersion = 36/);
    expect(gradle).toMatch(/targetSdkVersion = 36/);
  });

  it("assetlinks masih placeholder sehingga gate harus menolak rilis", () => {
    const links = JSON.parse(read("public/.well-known/assetlinks.json"));
    const prints: string[] = links[0].target.sha256_cert_fingerprints;
    const valid = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
    const semuaNyata = prints.every((p) => valid.test(p.toUpperCase()));
    // Bila fingerprint nyata sudah diisi, gate lulus; bila belum, script harus menolak.
    if (!semuaNyata) {
      expect(read("scripts/verify-assetlinks.mjs")).toContain("process.exit(1)");
      expect(read(".github/workflows/android-release.yml")).toContain("verify:assetlinks");
    }
    expect(links[0].target.package_name).toBe("com.mcm.privateconnect");
  });

  it("script build web tidak menyentuh folder native", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["build:web"]).toBe("vite build");
    expect(pkg.scripts["build:web"]).not.toMatch(/android/);
    expect(pkg.scripts["android:bundle"]).toMatch(/gradlew bundleRelease/);
    expect(pkg.scripts["verify:assetlinks"]).toBeTruthy();
  });
});

describe("pemilihan bisnis aktif", () => {
  it("myBusiness memakai preferensi tersimpan, bukan diam-diam bisnis pertama", () => {
    const src = read("src/lib/api/business.ts");
    expect(src).toContain("getActiveBusinessId");
    expect(src).toContain("listMyBusinesses");
    expect(src).not.toMatch(/business_members[\s\S]{0,200}\.limit\(1\)/);
  });
});
