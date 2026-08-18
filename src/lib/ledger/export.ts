import { LEDGER_STATUS_LABEL, remaining, type LedgerPaymentRow, type LedgerRow } from "@/lib/api/ledger";
import { rupiah, tanggal } from "@/lib/mcm/format";

const HEADERS = ["Tanggal", "Nominal", "Metode", "Catatan"] as const;

const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;

const slug = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catatan";

export function paymentsFileName(ledger: LedgerRow, ext: "csv" | "pdf") {
  return `pembayaran-${slug(ledger.counterpart_name ?? "catatan")}-${new Date()
    .toISOString()
    .slice(0, 10)}.${ext}`;
}

export function paymentsToCsv(ledger: LedgerRow, payments: LedgerPaymentRow[]) {
  const meta = [
    ["Catatan", ledger.counterpart_name ?? "-"],
    ["Jenis", ledger.type === "receivable" ? "Piutang" : "Utang"],
    ["Total tagihan", rupiah(Number(ledger.amount))],
    ["Sudah dibayar", rupiah(Number(ledger.paid_amount))],
    ["Sisa", rupiah(remaining(ledger))],
    ["Status", LEDGER_STATUS_LABEL[ledger.status]],
  ].map(([k, v]) => [escapeCsv(k), escapeCsv(v)].join(","));

  const lines = [...meta, "", HEADERS.join(",")];
  for (const p of payments) {
    lines.push(
      [
        tanggal(p.paid_at),
        rupiah(Number(p.amount)),
        String(p.method ?? "-"),
        String(p.note ?? ""),
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadPaymentsCsv(ledger: LedgerRow, payments: LedgerPaymentRow[]) {
  download(
    new Blob([paymentsToCsv(ledger, payments)], { type: "text/csv;charset=utf-8" }),
    paymentsFileName(ledger, "csv"),
  );
}

export async function downloadPaymentsPdf(ledger: LedgerRow, payments: LedgerPaymentRow[]) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 32;
  const cols = [96, 110, 90, 200];
  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Bukti Pembayaran — MCM", marginX, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const summary = [
    `${ledger.type === "receivable" ? "Piutang" : "Utang"} • ${ledger.counterpart_name ?? "-"}`,
    `Total ${rupiah(Number(ledger.amount))} • Dibayar ${rupiah(Number(ledger.paid_amount))} • Sisa ${rupiah(remaining(ledger))}`,
    `Status: ${LEDGER_STATUS_LABEL[ledger.status]} • Dicetak ${tanggal(new Date().toISOString())}`,
  ];
  for (const line of summary) {
    doc.text(line, marginX, y);
    y += 13;
  }
  y += 8;

  const drawHeader = () => {
    doc.setFont("helvetica", "bold");
    let x = marginX;
    HEADERS.forEach((h, i) => {
      doc.text(h, x, y);
      x += cols[i] ?? 0;
    });
    y += 6;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, marginX + cols.reduce((a, b) => a + b, 0), y);
    y += 12;
    doc.setFont("helvetica", "normal");
  };

  drawHeader();
  for (const p of payments) {
    if (y > 790) {
      doc.addPage();
      y = 48;
      drawHeader();
    }
    let x = marginX;
    [
      tanggal(p.paid_at),
      rupiah(Number(p.amount)),
      String(p.method ?? "-"),
      String(p.note ?? ""),
    ].forEach((cell, i) => {
      const text = doc.splitTextToSize(cell, (cols[i] ?? 60) - 6)[0] ?? "";
      doc.text(String(text), x, y);
      x += cols[i] ?? 0;
    });
    y += 14;
  }
  if (payments.length === 0) doc.text("Belum ada pembayaran yang dicatat.", marginX, y);

  doc.save(paymentsFileName(ledger, "pdf"));
}
