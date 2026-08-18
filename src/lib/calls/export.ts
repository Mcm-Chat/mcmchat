import type { CallHistoryItem } from "@/lib/api/calls";
import { callOutcome, OUTCOME_LABEL } from "@/lib/calls/outcome";
import { durasi, jam, tanggal } from "@/lib/mcm/format";

export type ExportPeriod = "7" | "30" | "90" | "all";

export const PERIOD_LABEL: Record<ExportPeriod, string> = {
  "7": "7 hari terakhir",
  "30": "30 hari terakhir",
  "90": "90 hari terakhir",
  all: "Semua waktu",
};

export type ExportRow = {
  nama: string;
  arah: string;
  jenis: string;
  status: string;
  durasi: string;
  waktu: string;
};

export function filterByPeriod(calls: CallHistoryItem[], period: ExportPeriod) {
  if (period === "all") return calls;
  const cutoff = Date.now() - Number(period) * 86_400_000;
  return calls.filter((c) => new Date(c.created_at).getTime() >= cutoff);
}

export function toExportRows(
  calls: CallHistoryItem[],
  userId: string | undefined,
  nameOf: (call: CallHistoryItem) => string,
): ExportRow[] {
  return calls.map((c) => ({
    nama: nameOf(c),
    arah: c.initiator_id === userId ? "Keluar" : "Masuk",
    jenis: c.kind === "video" ? "Video" : "Suara",
    status: OUTCOME_LABEL[callOutcome(c, userId)],
    durasi: c.duration_sec > 0 ? durasi(c.duration_sec) : "-",
    waktu: `${tanggal(c.created_at)} ${jam(c.created_at)}`,
  }));
}

const HEADERS = ["Nama", "Arah", "Jenis", "Status", "Durasi", "Waktu"] as const;

const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function rowsToCsv(rows: ExportRow[]) {
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.nama, r.arah, r.jenis, r.status, r.durasi, r.waktu].map(escapeCsv).join(","),
    );
  }
  // BOM agar Excel membaca karakter non-ASCII dengan benar.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function exportFileName(period: ExportPeriod, ext: "csv" | "pdf") {
  const stamp = new Date().toISOString().slice(0, 10);
  return `riwayat-panggilan-${period === "all" ? "semua" : `${period}hari`}-${stamp}.${ext}`;
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

export function downloadCsv(rows: ExportRow[], period: ExportPeriod) {
  download(
    new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" }),
    exportFileName(period, "csv"),
  );
}

export async function downloadPdf(rows: ExportRow[], period: ExportPeriod) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 32;
  const cols = [110, 48, 48, 78, 58, 118];
  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Riwayat Panggilan MCM", marginX, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Periode: ${PERIOD_LABEL[period]} — ${rows.length} entri`, marginX, y);
  y += 20;

  const drawHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    let x = marginX;
    HEADERS.forEach((h, i) => {
      doc.text(h, x, y);
      x += cols[i];
    });
    y += 6;
    doc.setLineWidth(0.5);
    doc.line(marginX, y, marginX + cols.reduce((a, b) => a + b, 0), y);
    y += 12;
    doc.setFont("helvetica", "normal");
  };

  drawHeader();
  for (const r of rows) {
    if (y > 790) {
      doc.addPage();
      y = 48;
      drawHeader();
    }
    let x = marginX;
    [r.nama, r.arah, r.jenis, r.status, r.durasi, r.waktu].forEach((cell, i) => {
      const text = doc.splitTextToSize(cell, cols[i] - 6)[0] ?? "";
      doc.text(String(text), x, y);
      x += cols[i];
    });
    y += 14;
  }
  if (rows.length === 0) doc.text("Tidak ada panggilan pada periode ini.", marginX, y);

  doc.save(exportFileName(period, "pdf"));
}
