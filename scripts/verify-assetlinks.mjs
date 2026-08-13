#!/usr/bin/env node
/**
 * Gate rilis: `public/.well-known/assetlinks.json` tidak boleh berisi
 * fingerprint placeholder atau format SHA-256 yang tidak valid.
 *
 * Dipakai oleh `bun run verify:assetlinks` dan workflow rilis Android.
 * Nilai fingerprint diambil dari Play Console → Setup → App signing
 * (Play App Signing key, bukan upload key) atau lewat MCM_ASSETLINKS_SHA256.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "public/.well-known/assetlinks.json";
const PACKAGE = "com.mcm.privateconnect";
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const inject = process.env["MCM_ASSETLINKS_SHA256"];
const raw = readFileSync(FILE, "utf8");
const doc = JSON.parse(raw);

if (inject) {
  const fp = inject.trim().toUpperCase();
  if (!SHA256.test(fp)) {
    console.error(`FAIL: MCM_ASSETLINKS_SHA256 bukan SHA-256 valid (32 byte hex dipisah ':').`);
    process.exit(1);
  }
  doc[0].target.sha256_cert_fingerprints = [fp];
  writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
  console.log("assetlinks.json diperbarui dari MCM_ASSETLINKS_SHA256.");
}

const entry = Array.isArray(doc) ? doc[0] : null;
const errors = [];
if (!entry) errors.push("assetlinks.json harus berupa array berisi minimal satu statement.");
if (entry?.target?.package_name !== PACKAGE) errors.push(`package_name harus ${PACKAGE}.`);
const prints = entry?.target?.sha256_cert_fingerprints ?? [];
if (prints.length === 0) errors.push("sha256_cert_fingerprints kosong.");
for (const fp of prints) {
  if (typeof fp !== "string" || !SHA256.test(fp.toUpperCase())) {
    errors.push(`Fingerprint belum nyata/valid: ${String(fp)}`);
  }
}

if (errors.length > 0) {
  console.error("FAIL verify:assetlinks");
  for (const e of errors) console.error(` - ${e}`);
  console.error("Isi fingerprint asli sebelum rilis App Links (lihat ANDROID_RELEASE.md §6).");
  process.exit(1);
}
console.log("PASS verify:assetlinks — fingerprint nyata dan package cocok.");
