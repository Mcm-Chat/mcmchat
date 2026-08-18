import { LEDGER_STATUS_LABEL, remaining, type LedgerPaymentRow, type LedgerRow } from "@/lib/api/ledger";
import { rupiah, tanggal } from "@/lib/mcm/format";
import { absoluteUrl } from "@/lib/site";

const HEADERS = ["Tanggal", "Nominal", "Metode", "Catatan"] as const;

const escapeCsv = (v: string) => `"${v.replace(/"/g, '""')}"`;

const slug = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "catatan";

export function paymentsFileName(ledger: LedgerRow, ext: "csv" | "pdf", receipt?: string) {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = receipt ? `-${receipt.replace(/[^A-Za-z0-9-]/g, "")}` : "";
  return `pembayaran-${slug(ledger.counterpart_name ?? "catatan")}-${date}${suffix}.${ext}`;
}

const B32 = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Nomor bukti unik, mis. MCM-20260818-7QF3K2 */
export function receiptNumber(ledger: LedgerRow, at = new Date()) {
  const date = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  let seed = 0;
  const base = `${ledger.id}|${at.getTime()}|${Math.random()}`;
  for (let i = 0; i < base.length; i++) seed = (seed * 31 + base.charCodeAt(i)) >>> 0;
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += B32[seed % B32.length];
    seed = Math.floor(seed / B32.length) + (i + 1) * 7919;
  }
  return `MCM-${date}-${code}`;
}

/** Tautan verifikasi yang di-encode ke QR pada PDF bukti. */
export function verifyUrl(ledger: LedgerRow, receipt: string) {
  const params = new URLSearchParams({
    bukti: receipt,
    catatan: ledger.id,
    total: String(Number(ledger.amount)),
    dibayar: String(Number(ledger.paid_amount)),
    sisa: String(remaining(ledger)),
  });
  return absoluteUrl(`/support?${params.toString()}`);
}

export function paymentsToCsv(
  ledger: LedgerRow,
  payments: LedgerPaymentRow[],
  receipt = receiptNumber(ledger),
) {
  const meta = [
    ["No. bukti", receipt],
    ["Catatan", ledger.counterpart_name ?? "-"],
    ["Jenis", ledger.type === "receivable" ? "Piutang" : "Utang"],
    ["Total tagihan", rupiah(Number(ledger.amount))],
    ["Sudah dibayar", rupiah(Number(ledger.paid_amount))],
    ["Sisa", rupiah(remaining(ledger))],
    ["Status", LEDGER_STATUS_LABEL[ledger.status]],
    ["Dicetak", tanggal(new Date().toISOString())],
    ["Verifikasi", verifyUrl(ledger, receipt)],
  ].map(([k, v]) => [escapeCsv(k ?? ""), escapeCsv(v ?? "")].join(","));

  const lines = [
    escapeCsv(`Bukti Pembayaran — MCM (${receipt})`),
    ...meta,
    "",
    [...HEADERS, "No. bukti"].join(","),
  ];
  for (const p of payments) {
    lines.push(
      [
        tanggal(p.paid_at),
        rupiah(Number(p.amount)),
        String(p.method ?? "-"),
        String(p.note ?? ""),
        receipt,
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
  const QR = (await import("qrcode")).default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 32;
  const cols = [96, 110, 90, 200];
  let y = 48;
  const receipt = receiptNumber(ledger);
  const verify = verifyUrl(ledger, receipt);
  const qrDataUrl = await QR.toDataURL(verify, {
    margin: 0,
    width: 240,
    errorCorrectionLevel: "M",
  }).catch(() => null);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const decoratePage = () => {
    // Watermark diagonal
    doc.saveGraphicsState();
    // @ts-expect-error GState is available at runtime in jsPDF
    doc.setGState(new doc.GState({ opacity: 0.08 }));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(46);
    doc.setTextColor(0, 0, 0);
    doc.text("MCM — Private Chat", pageW / 2, pageH / 2, {
      align: "center",
      angle: 35,
    });
    doc.restoreGraphicsState();
    // Nomor bukti di footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`No. bukti: ${receipt}`, marginX, pageH - 24);
    doc.text("MCM — Private Chat", pageW - marginX, pageH - 24, { align: "right" });
    doc.setTextColor(0, 0, 0);
  };

  decoratePage();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Bukti Pembayaran — MCM", marginX, y);
  y += 18;

  // QR verifikasi di kanan atas halaman pertama
  if (qrDataUrl) {
    const qrSize = 78;
    const qrX = pageW - marginX - qrSize;
    doc.addImage(qrDataUrl, "PNG", qrX, 34, qrSize, qrSize);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text("Scan untuk verifikasi", qrX + qrSize / 2, 34 + qrSize + 9, { align: "center" });
    doc.text(receipt, qrX + qrSize / 2, 34 + qrSize + 18, { align: "center" });
    doc.setTextColor(0, 0, 0);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const summary = [
    `No. bukti: ${receipt}`,
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
      decoratePage();
      y = 48;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
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
