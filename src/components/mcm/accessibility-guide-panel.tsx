import { Accessibility, Keyboard, XSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccessibilityGuidePanelProps {
  onGoToCalls?: () => void;
}

export function AccessibilityGuidePanel({ onGoToCalls }: AccessibilityGuidePanelProps) {
  return (
    <section
      className="card-soft space-y-3 p-4"
      aria-labelledby="a11y-guide-title"
      aria-describedby="a11y-guide-desc"
    >
      <div className="flex items-center gap-2">
        <Accessibility className="size-5 text-primary" aria-hidden="true" />
        <h2 id="a11y-guide-title" className="text-sm font-semibold">
          Panduan aksesibilitas
        </h2>
      </div>
      <p id="a11y-guide-desc" className="text-xs text-muted-foreground">
        Panduan singkat menguji navigasi keyboard dan pintasan Escape di halaman Panggilan.
      </p>

      <div className="space-y-3 rounded-xl bg-muted/40 p-3">
        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Keyboard className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Uji urutan Tab</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Buka halaman <strong className="text-foreground">Panggilan</strong>.</li>
              <li>Tekan tombol <kbd className="rounded border bg-background px-1 font-mono">Tab</kbd> berulang kali.</li>
              <li>Pastikan fokus bergerak secara logis: tombol panggilan → daftar riwayat → aksi cepat → modal (bila dibuka).</li>
              <li>Di modal <strong>Panggilan baru</strong>, fokus pertama harus langsung ke kolom pencarian kontak.</li>
            </ol>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <XSquare className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">Uji tombol Escape</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Buka modal Panggilan baru atau sheet panggilan tak terjawab.</li>
              <li>Tekan <kbd className="rounded border bg-background px-1 font-mono">Esc</kbd>.</li>
              <li>Modal/sheet harus tertutup dan fokus kembali ke tombol pemicunya.</li>
              <li>Bila tidak ada modal terbuka, Escape menutup banner/notifikasi teratas.</li>
            </ol>
          </div>
        </div>
      </div>

      {onGoToCalls && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full rounded-lg"
          onClick={onGoToCalls}
          aria-label="Buka halaman Panggilan untuk menguji aksesibilitas"
        >
          Buka halaman Panggilan
          <ArrowRight className="ml-1 size-4" aria-hidden="true" />
        </Button>
      )}
    </section>
  );
}
