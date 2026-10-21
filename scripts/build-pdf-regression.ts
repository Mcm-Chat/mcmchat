/** Offline browser fixture build. Only backend metadata is isolated; PDF/QR
 * rendering use the actual browser packages and production external predicate. */
import { build } from "vite";
import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isUnusedPdfRenderer } from "./pdf-optional-dependencies.ts";

const root = process.cwd();
const ledgerSource = readFileSync(path.join(root, "src/lib/api/ledger.ts"), "utf8");
const metadata = ts.transpileModule(
  ledgerSource.slice(
    ledgerSource.indexOf("export const LEDGER_STATUS_LABEL"),
    ledgerSource.indexOf("export const OPEN_STATUSES"),
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const output = process.env["PDF_BROWSER_OUTPUT"] ?? "/tmp/mcm-pdf-browser";
for (const mode of ["baseline", "candidate"]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    resolve: { alias: { "@": path.join(root, "src") } },
    plugins: [
      {
        name: "offline-pdf-fixtures",
        enforce: "pre",
        resolveId(id, importer) {
          if (id === "pdf-fixture-entry" || id === path.join(root, "pdf-fixture-entry"))
            return "\0pdf-fixture-entry";
          if (id === "@/lib/api/ledger" || id === path.join(root, "src/lib/api/ledger.ts"))
            return "\0ledger-metadata";
          if (mode === "candidate" && isUnusedPdfRenderer(id, importer))
            return { id, external: true };
          return null;
        },
        load(id) {
          if (id === "\0ledger-metadata" || id === path.join(root, "src/lib/api/ledger.ts"))
            return metadata;
          if (id === "\0pdf-fixture-entry")
            return `
          import { downloadPdf } from "@/lib/calls/export";
          import { downloadPaymentsPdf } from "@/lib/ledger/export";
          globalThis.__pdfs = [];
          globalThis.__capturePdf = (doc, filename) => {
            doc.setFileId("00112233445566778899AABBCCDDEEFF");
            doc.setCreationDate(new Date("2026-10-21T00:00:00Z"));
            globalThis.__pdfs.push({filename, data: doc.output("datauristring").split(",")[1]});
          };
          globalThis.runPdfFixtures = async () => {
            const row = {nama:"Café • Nama pelanggan panjang untuk menguji pemotongan kolom",arah:"Keluar",jenis:"Video",status:"Terjawab",durasi:"01:30",waktu:"21 Okt 2026 07.00"};
            const ledger = {id:"pdf-regression-ledger",type:"receivable",counterpart_name:"Café • Pembeli Indonesia",amount:1250000,paid_amount:250000,status:"partially_paid"};
            const payment = {paid_at:"2026-10-20T10:00:00Z",amount:125000,method:"Transfer bank",note:"Pembayaran café — catatan panjang untuk menguji pemotongan kolom"};
            for (const count of [0,3,120]) {
              await downloadPdf(Array.from({length:count}, () => row), "all");
              await downloadPaymentsPdf(ledger, Array.from({length:count}, () => payment), "MCM-20261021-ABC234");
            }
            for (const [type, status, paid_amount] of [["payable", "active", 0], ["receivable", "paid", 1250000]]) {
              await downloadPaymentsPdf({...ledger, type, status, paid_amount}, [], "MCM-20261021-ABC234");
            }
            await downloadPdf([{...row, nama:"مرحبا بالعالم — العربية"}], "7");
            return globalThis.__pdfs;
          };`;
          const relative = path.relative(root, id);
          if (["src/lib/calls/export.ts", "src/lib/ledger/export.ts"].includes(relative)) {
            const current = readFileSync(id, "utf8");
            if (!current.includes('import("@/lib/pdf/client")')) {
              throw new Error(`PDF fixture lazy boundary changed: ${relative}`);
            }
            // Full upstream renderer baseline, independent of local Git history.
            // Exporter layout and data are exactly the same for both builds.
            const source =
              mode === "baseline"
                ? current.replace('import("@/lib/pdf/client")', 'import("jspdf")')
                : current;
            return source.replace(/doc\.save\((.*)\);/g, "globalThis.__capturePdf(doc, $1);");
          }
          return null;
        },
      },
    ],
    build: {
      outDir: path.join(output, mode),
      emptyOutDir: true,
      minify: true,
      lib: { entry: "pdf-fixture-entry", formats: ["es"], fileName: "fixture" },
    },
  });
}
