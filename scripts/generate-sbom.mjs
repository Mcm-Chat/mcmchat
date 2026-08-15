#!/usr/bin/env node
/**
 * Pembuat SBOM tanpa dependensi eksternal.
 * Menelusuri node_modules (termasuk paket bersarang/scoped) dan menulis
 * dua berkas: CycloneDX 1.5 JSON dan SPDX 2.3 JSON.
 *
 * Dipakai di CI (job `sbom`) lalu diunggah sebagai artefak build.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const outDir = resolve(root, process.argv[2] ?? 'sbom');
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** @type {Map<string, {name:string,version:string,license:string,description:string}>} */
const packages = new Map();

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
  return 'NOASSERTION';
}

function walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const name = entry.name;
    if (name === '.bin' || name === '.cache') continue;
    const full = join(dir, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    if (name.startsWith('@')) {
      walk(full, depth);
      continue;
    }
    const pkg = readJson(join(full, 'package.json'));
    if (pkg?.name && pkg?.version) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!packages.has(key)) {
        packages.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: licenseOf(pkg),
          description: typeof pkg.description === 'string' ? pkg.description.slice(0, 300) : '',
        });
      }
    }
    walk(join(full, 'node_modules'), depth + 1);
  }
}

walk(join(root, 'node_modules'));

const sorted = [...packages.values()].sort((a, b) =>
  a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
);

const purl = (p) => `pkg:npm/${p.name.replace('@', '%40')}@${p.version}`;
const spdxId = (p) => `SPDXRef-Package-${`${p.name}@${p.version}`.replace(/[^A-Za-z0-9.-]/g, '-')}`;
const timestamp = new Date().toISOString();
const serial = `urn:uuid:${createHash('sha256')
  .update(sorted.map(purl).join('\n'))
  .digest('hex')
  .slice(0, 32)
  .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')}`;

const cyclonedx = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: serial,
  version: 1,
  metadata: {
    timestamp,
    tools: [{ vendor: 'MCM', name: 'generate-sbom', version: '1.0.0' }],
    component: {
      type: 'application',
      'bom-ref': purl({ name: rootPkg.name ?? 'mcm-chat', version: rootPkg.version ?? '0.0.0' }),
      name: rootPkg.name ?? 'mcm-chat',
      version: rootPkg.version ?? '0.0.0',
    },
  },
  components: sorted.map((p) => ({
    type: 'library',
    'bom-ref': purl(p),
    name: p.name,
    version: p.version,
    purl: purl(p),
    ...(p.description ? { description: p.description } : {}),
    ...(p.license !== 'NOASSERTION' ? { licenses: [{ license: { name: p.license } }] } : {}),
  })),
};

const spdx = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${rootPkg.name ?? 'mcm-chat'}-sbom`,
  documentNamespace: `https://mcmchat.ai/sbom/${serial.replace('urn:uuid:', '')}`,
  creationInfo: { created: timestamp, creators: ['Tool: generate-sbom-1.0.0', 'Organization: MCM'] },
  packages: sorted.map((p) => ({
    name: p.name,
    SPDXID: spdxId(p),
    versionInfo: p.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: p.license,
    copyrightText: 'NOASSERTION',
    externalRefs: [
      { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: purl(p) },
    ],
  })),
  relationships: sorted.map((p) => ({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relatedSpdxElement: spdxId(p),
    relationshipType: 'DESCRIBES',
  })),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'sbom.cyclonedx.json'), `${JSON.stringify(cyclonedx, null, 2)}\n`);
writeFileSync(join(outDir, 'sbom.spdx.json'), `${JSON.stringify(spdx, null, 2)}\n`);

if (sorted.length === 0) {
  console.error('SBOM kosong: jalankan `bun install` dulu.');
  process.exit(1);
}
console.log(`SBOM dibuat: ${sorted.length} paket -> ${outDir}/sbom.cyclonedx.json, ${outDir}/sbom.spdx.json`);
