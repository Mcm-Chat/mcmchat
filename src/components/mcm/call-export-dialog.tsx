import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CallHistoryItem } from "@/lib/api/calls";
import {
  downloadCsv,
  downloadPdf,
  filterByPeriod,
  PERIOD_LABEL,
  toExportRows,
  type ExportPeriod,
} from "@/lib/calls/export";

const PERIODS: ExportPeriod[] = ["7", "30", "90", "all"];

export function CallExportDialog({
  calls,
  userId,
  nameOf,
}: {
  calls: CallHistoryItem[];
  userId?: string | undefined;
  nameOf: (call: CallHistoryItem) => string;
}) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<ExportPeriod>("30");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => toExportRows(filterByPeriod(calls, period), userId, nameOf),
    [calls, period, userId, nameOf],
  );

  const run = async (kind: "csv" | "pdf") => {
    if (rows.length === 0) {
      toast.error("Tidak ada panggilan pada periode ini");
      return;
    }
    setBusy(true);
    try {
      if (kind === "csv") downloadCsv(rows, period);
      else await downloadPdf(rows, period);
      toast.success(`Ekspor ${kind.toUpperCase()} selesai (${rows.length} entri)`);
      setOpen(false);
    } catch {
      toast.error("Gagal membuat file ekspor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Ekspor riwayat panggilan"
          title="Ekspor riwayat panggilan"
        >
          <Download className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>Ekspor riwayat panggilan</DialogTitle>
          <DialogDescription>
            Kolom: nama, arah, jenis, status, durasi, dan waktu.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Periode</legend>
          <div className="grid grid-cols-2 gap-2">
            {PERIODS.map((p) => (
              <Button
                key={p}
                type="button"
                variant={period === p ? "default" : "outline"}
                className="h-10 rounded-xl text-sm"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
              >
                {PERIOD_LABEL[p]}
              </Button>
            ))}
          </div>
        </fieldset>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {rows.length} panggilan akan diekspor.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            disabled={busy}
            onClick={() => void run("csv")}
          >
            <FileSpreadsheet className="size-4" /> CSV
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl"
            disabled={busy}
            onClick={() => void run("pdf")}
          >
            <FileText className="size-4" /> PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
