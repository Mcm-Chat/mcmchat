// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { jsPDF as OriginalPDF } from "jspdf";
import type { LedgerPaymentRow, LedgerRow } from "@/lib/api/ledger";
import type { ExportRow } from "@/lib/calls/export";

const captured = vi.hoisted(() => ({ docs: [] as { filename: string; bytes: Uint8Array }[] }));
vi.mock("jspdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("jspdf")>();
  return {
    jsPDF: class extends original.jsPDF {
      constructor(options: ConstructorParameters<typeof original.jsPDF>[0]) {
        super(options);
        this.setFileId("00112233445566778899AABBCCDDEEFF");
        this.setCreationDate(new Date("2026-10-21T00:00:00Z"));
        const capture = (filename: string): OriginalPDF => {
          captured.docs.push({ filename, bytes: new Uint8Array(this.output("arraybuffer")) });
          return this;
        };
        function save(filename: string, options: { returnPromise: true }): Promise<void>;
        function save(filename?: string): OriginalPDF;
        function save(
          filename = "document.pdf",
          options?: { returnPromise: true },
        ): OriginalPDF | Promise<void> {
          const result = capture(filename);
          return options?.returnPromise ? Promise.resolve() : result;
        }
        this.save = save;
      }
    },
  };
});
// Exporters only consume these pure metadata helpers; importing the rest of
// the API would initialize backend clients unrelated to PDF generation.
vi.mock("@/lib/api/ledger", () => ({
  LEDGER_STATUS_LABEL: { partially_paid: "Dibayar sebagian" },
  remaining: (ledger: LedgerRow) => Math.max(0, Number(ledger.amount) - Number(ledger.paid_amount)),
}));

const { downloadPdf } = await import(process.env["PDF_BASELINE_CALLS"] ?? "@/lib/calls/export");
const { downloadPaymentsPdf } = await import(
  process.env["PDF_BASELINE_LEDGER"] ?? "@/lib/ledger/export"
);

const ledger = {
  id: "pdf-regression-ledger",
  type: "receivable",
  counterpart_name: "Café • Pembeli Indonesia",
  amount: 1250000,
  paid_amount: 250000,
  status: "partially_paid",
} as LedgerRow;
const row: ExportRow = {
  nama: "Café • Nama pelanggan panjang untuk menguji pemotongan kolom",
  arah: "Keluar",
  jenis: "Video",
  status: "Terjawab",
  durasi: "01:30",
  waktu: "21 Okt 2026 07.00",
};
const payment = {
  paid_at: "2026-10-20T10:00:00Z",
  amount: 125000,
  method: "Transfer bank",
  note: "Pembayaran café — catatan panjang untuk menguji pemotongan kolom",
} as LedgerPaymentRow;

function pdfText(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("latin1");
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
  const output = process.env["PDF_REGRESSION_OUTPUT"];
  if (output) {
    mkdirSync(output, { recursive: true });
    captured.docs.forEach((doc, index) =>
      writeFileSync(`${output}/${index}-${doc.filename}`, doc.bytes),
    );
  }
});

describe("real PDF exporters", () => {
  it("limits exporters to reviewed text/table/PNG APIs, never optional HTML/SVG renderers", () => {
    const reviewed = new Set([
      "setFont",
      "setFontSize",
      "text",
      "setLineWidth",
      "line",
      "splitTextToSize",
      "addPage",
      "save",
      "saveGraphicsState",
      "setGState",
      "GState",
      "setTextColor",
      "restoreGraphicsState",
      "addImage",
      "internal",
    ]);
    for (const file of ["src/lib/calls/export.ts", "src/lib/ledger/export.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('import("@/lib/pdf/client")');
      const methods = [...source.matchAll(/\bdoc\.(\w+)/g)].map((match) => match[1]);
      expect(methods.length).toBeGreaterThan(0);
      for (const method of methods)
        expect(reviewed.has(method!), `Review new PDF API: ${method}`).toBe(true);
      expect(source).not.toMatch(/\b(?:html|addSvgAsImage)\s*\(/);
    }
  });
  it("keeps the upstream jsPDF implementation, rather than a replacement renderer", async () => {
    const adapter = await vi.importActual<typeof import("@/lib/pdf/client")>("@/lib/pdf/client");
    expect(adapter.jsPDF).toBe(OriginalPDF);
  });

  for (const count of [0, 3, 120]) {
    it(`exports ${count} call rows with repeated page headers`, async () => {
      await downloadPdf(
        Array.from({ length: count }, () => row),
        "all",
      );
      const doc = captured.docs.at(-1)!;
      const text = pdfText(doc.bytes);
      expect(doc.filename).toBe("riwayat-panggilan-semua-2026-10-21.pdf");
      expect(text).toContain("%PDF-1.3");
      expect(text).toContain("Riwayat Panggilan MCM");
      const pages = text.match(/\/Type \/Page\b/g)?.length ?? 0;
      expect(pages).toBe(count === 120 ? 3 : 1);
      expect(text.match(/\(Nama\)/g)).toHaveLength(pages);
      if (count === 0) expect(text).toContain("Tidak ada panggilan pada periode ini.");
    });
    it(`exports ${count} payments with genuine PNG QR, opacity watermark and receipt footers`, async () => {
      const result = await downloadPaymentsPdf(
        ledger,
        Array.from({ length: count }, () => payment),
        "MCM-20261021-ABC234",
      );
      const doc = captured.docs.at(-1)!;
      const text = pdfText(doc.bytes);
      expect(result.fileName).toBe(doc.filename);
      expect(result.receipt).toBe("MCM-20261021-ABC234");
      expect(text).toContain("/Subtype /Image");
      expect(text).toContain("/ca 0.08");
      expect(text).toContain("Scan untuk verifikasi");
      const pages = text.match(/\/Type \/Page\b/g)?.length ?? 0;
      expect(pages).toBe(count === 120 ? 3 : 1);
      expect(text.match(/\(Tanggal\)/g)).toHaveLength(pages);
      expect(text.match(/No\. bukti: MCM-20261021-ABC234/g)?.length).toBe(pages + 1);
      if (count === 0) expect(text).toContain("Belum ada pembayaran yang dicatat.");
    });
  }
});
