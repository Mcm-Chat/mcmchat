import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Perekam temuan gate PIN. Setiap kali sebuah respons endpoint memunculkan
 * field bernuansa PIN, tes memanggil `recordPinFinding` sehingga CI bisa
 * menyimpan artefak JSON + HTML berisi endpoint, pemanggil, status HTTP, dan
 * jalur key yang bocor.
 *
 * Yang disimpan hanya METADATA: nama endpoint dan JALUR key (mis.
 * `$[0].customers.pin`). Nilai PIN, token, dan isi baris tidak pernah ditulis.
 */
export type PinFinding = {
  /** Kategori sumber temuan, mis. "table", "embed", "rpc", "explicit-column". */
  kind: string;
  /** Label yang mudah dibaca manusia. */
  label: string;
  /** Path Data API yang dipanggil (tanpa host/kunci). */
  endpoint: string;
  /** Peran pemanggil: anon atau member. */
  caller: string;
  /** Status HTTP respons, jika diketahui. */
  status?: number | undefined;
  /** Jalur key bernuansa PIN yang ditemukan pada payload. */
  keys: string[];
};

const findings: PinFinding[] = [];
const OUT_DIR = process.env["PIN_REPORT_DIR"] ?? "pin-exposure-report";

export function recordPinFinding(finding: PinFinding): void {
  findings.push(finding);
  schedule();
}

export function pinFindings(): readonly PinFinding[] {
  return findings;
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  process.on("exit", () => {
    try {
      writePinReport();
    } catch {
      /* artefak bersifat bantu-debug; jangan menutupi kegagalan tes */
    }
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Tulis artefak JSON + HTML. Mengembalikan direktori keluaran. */
export function writePinReport(dir = OUT_DIR): string {
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    commit: process.env["GITHUB_SHA"] ?? null,
    ref: process.env["GITHUB_REF"] ?? null,
    total: findings.length,
    findings,
  };
  const jsonPath = join(dir, "pin-exposure.json");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + "\n");

  const rows = findings
    .map(
      (f) => `<tr>
      <td>${esc(f.kind)}</td>
      <td>${esc(f.label)}</td>
      <td><code>${esc(f.endpoint)}</code></td>
      <td>${esc(f.caller)}</td>
      <td>${f.status ?? "-"}</td>
      <td><code>${esc(f.keys.join(", "))}</code></td>
    </tr>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Laporan eksposur PIN</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#0f1115;color:#e7e9ee}
 h1{font-size:18px;margin:0 0 4px} p{margin:0 0 12px;color:#9aa3b2}
 .ok{padding:12px;border-radius:10px;background:#12301f;color:#8ff0b5}
 table{width:100%;border-collapse:collapse;font-size:12.5px}
 th,td{border-bottom:1px solid #232735;padding:8px 6px;text-align:left;vertical-align:top;word-break:break-word}
 th{color:#9aa3b2;font-weight:600}
 code{color:#ffb4b4}
 @media(max-width:640px){th:nth-child(1),td:nth-child(1){display:none}}
</style></head><body>
<h1>Laporan eksposur PIN</h1>
<p>Dibuat ${esc(generatedAt)}${payload.commit ? ` · commit ${esc(payload.commit)}` : ""} · ${findings.length} temuan</p>
${
  findings.length === 0
    ? `<div class="ok">Tidak ada respons endpoint yang memunculkan field PIN.</div>`
    : `<table><thead><tr><th>Jenis</th><th>Label</th><th>Endpoint</th><th>Pemanggil</th><th>HTTP</th><th>Key PIN</th></tr></thead><tbody>
${rows}
</tbody></table>`
}
<p style="margin-top:12px">Hanya jalur key yang dicatat; nilai PIN tidak pernah disimpan.</p>
</body></html>
`;
  writeFileSync(join(dir, "pin-exposure.html"), html);
  return dir;
}
