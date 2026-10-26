import { Link } from "@tanstack/react-router";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * This repository implements sharing through the OS share sheet, not a WhatsApp
 * account connector. Never infer a user's Meta account state from that absence.
 */
export function WhatsAppSettingsStatus() {
  return (
    <section
      aria-labelledby="whatsapp-settings-title"
      className="min-w-0 space-y-4 rounded-2xl border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <MessageCircle className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="whatsapp-settings-title" className="text-sm font-semibold">
            WhatsApp Business
          </h2>
          <p className="text-xs text-muted-foreground">
            Konektor akun belum tersedia pada versi aplikasi ini.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">
            Koneksi ke TOKOLINK: belum dapat diperiksa.
          </span>{" "}
          Periksa nomor dan akun bisnis Anda melalui WhatsApp Manager.
        </p>
        <p>
          Fitur Bagikan memakai menu berbagi perangkat atau salin teks. Fitur ini tidak
          menyinkronkan kotak masuk, riwayat pesan, atau panggilan WhatsApp.
        </p>
      </div>

      <details className="rounded-xl border px-3 py-2 text-xs">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">
          Kebutuhan integrasi resmi
        </summary>
        <ul className="list-disc space-y-2 pb-2 pl-4 text-muted-foreground">
          <li>Penautan setiap akun melalui proses resmi Meta dan verifikasi nomor yang sesuai.</li>
          <li>
            Token dan rahasia aplikasi disimpan aman di server, dengan akses terpisah per akun.
          </li>
          <li>
            Webhook terverifikasi untuk pesan dan status pengiriman; izin serta templat pesan
            mengikuti ketentuan layanan.
          </li>
        </ul>
      </details>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild variant="outline" className="min-h-11 whitespace-normal rounded-xl">
          <a
            href="https://business.facebook.com/wa/manage/home/"
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp Manager
            <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
            <span className="sr-only"> (buka di tab baru)</span>
          </a>
        </Button>
        <Button asChild variant="secondary" className="min-h-11 rounded-xl">
          <Link to="/support">Pusat bantuan</Link>
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Membuka WhatsApp Manager tidak menautkan akun ke TOKOLINK secara otomatis.
      </p>
    </section>
  );
}
