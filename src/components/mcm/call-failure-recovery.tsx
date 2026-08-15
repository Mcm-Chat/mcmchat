import { useEffect, useRef } from "react";
import { AlertTriangle, RotateCcw, SlidersHorizontal, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NotificationBanner } from "@/components/mcm/notification-banner";
import { useModalA11y } from "@/lib/a11y/use-modal-a11y";
import { summarizeCallFailure, type CallFailureAction } from "@/lib/calls/failure-messages";
import { cn } from "@/lib/utils";

export type CallFailureKind = "network" | "permission" | "device" | "provider" | "unknown";

type Props = {
  /** Alasan mentah dari sesi panggilan (boleh null). */
  reason: string | null;
  /** Penyedia belum dikonfigurasi (bukan kegagalan jaringan). */
  unconfigured?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
  onOpenDevices?: () => void;
  onOpenProvider?: () => void;
  onDismiss?: () => void;
  className?: string;
  /** Kunci fokus di dalam panel pemulihan (dipakai pada layar panggilan gagal). */
  trapFocus?: boolean;
  /** Sasaran fokus cadangan saat panel ditutup (misal tombol "Kembali"). */
  fallbackFocus?: () => HTMLElement | null;
};

/** Terjemahkan alasan teknis jadi kategori pemulihan yang bisa ditindaklanjuti. */
export function classifyCallFailure(reason: string | null, unconfigured?: boolean): CallFailureKind {
  if (unconfigured) return "provider";
  const r = (reason ?? "").toLowerCase();
  if (/izin|permission|denied|notallowed/.test(r)) return "permission";
  if (/perangkat|device|mikrofon|microphone|kamera|camera|notfound|notreadable|sedang dipakai/.test(r))
    return "device";
  if (/sinyal|jaringan|network|koneksi|connection|timeout|ice|signal|terputus/.test(r))
    return "network";
  if (/token|penyedia|provider|livekit|kredensial/.test(r)) return "provider";
  return "unknown";
}

const TITLE: Record<CallFailureKind, string> = {
  network: "Koneksi panggilan terputus",
  permission: "Izin mikrofon/kamera ditolak",
  device: "Perangkat audio/video bermasalah",
  provider: "Penyedia panggilan belum siap",
  unknown: "Panggilan gagal",
};

const HINT: Record<CallFailureKind, string> = {
  network: "Jaringan tidak stabil saat menyambungkan media. Pastikan sinyal/Wi-Fi stabil, lalu coba sambungkan lagi.",
  permission:
    "Browser atau sistem menolak akses mikrofon/kamera. Izinkan akses di pengaturan aplikasi, lalu coba sambungkan lagi.",
  device:
    "Mikrofon atau kamera tidak terbaca (mungkin dipakai aplikasi lain). Ganti perangkat input, lalu coba sambungkan lagi.",
  provider:
    "Kredensial layanan panggilan belum lengkap atau ditolak. Periksa pengaturan penyedia panggilan sebelum mencoba lagi.",
  unknown: "Panggilan tidak dapat disambungkan. Coba sambungkan lagi atau ganti perangkat/penyedia.",
};

/**
 * Panel pemulihan kegagalan panggilan: pesan jelas per kategori, tombol
 * "Coba sambungkan lagi" yang otomatis difokuskan, serta jalan keluar
 * mengganti perangkat atau penyedia.
 */
export function CallFailureRecovery({
  reason,
  unconfigured,
  retrying,
  onRetry,
  onOpenDevices,
  onOpenProvider,
  onDismiss,
  className,
  trapFocus,
  fallbackFocus,
}: Props) {
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const kind = classifyCallFailure(reason, unconfigured);
  const summary = summarizeCallFailure(reason, unconfigured);
  // Panel kegagalan diperlakukan sebagai dialog peringatan: Tab berputar di
  // dalam panel, Escape menutup, dan fokus kembali ke pemicu/tombol Kembali.
  const panelRef = useModalA11y<HTMLDivElement>({
    onClose: () => onDismiss?.(),
    active: Boolean(trapFocus),
    closeOnEscape: Boolean(onDismiss),
    fallbackFocus: fallbackFocus ?? (() => null),
  });

  // Fokus otomatis ke tombol percobaan agar pengguna keyboard/pembaca layar
  // langsung berada di aksi pemulihan utama.
  useEffect(() => {
    const id = requestAnimationFrame(() => retryRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [kind]);

  // Aksi langsung diurutkan: yang paling relevan dengan penyebab tampil dulu.
  const order: CallFailureAction[] =
    summary.primary === "devices"
      ? ["devices", "retry", "provider"]
      : summary.primary === "provider"
        ? ["provider", "retry", "devices"]
        : ["retry", "devices", "provider"];

  const retryButton = onRetry ? (
    <Button
      key="retry"
      ref={retryRef}
      className="min-h-11 rounded-xl px-4"
      disabled={retrying}
      onClick={onRetry}
    >
      <RotateCcw className="mr-1.5 size-4" aria-hidden="true" />
      {retrying ? "Menyambungkan…" : summary.primary === "permission" ? "Minta izin lagi" : "Coba sambungkan lagi"}
    </Button>
  ) : null;

  const deviceButton = onOpenDevices ? (
    <Button key="devices" variant="secondary" className="min-h-11 rounded-xl px-4" onClick={onOpenDevices}>
      <SlidersHorizontal className="mr-1.5 size-4" aria-hidden="true" />
      Ganti perangkat
    </Button>
  ) : null;

  const providerButton = onOpenProvider ? (
    <Button key="provider" variant="secondary" className="min-h-11 rounded-xl px-4" onClick={onOpenProvider}>
      <Wrench className="mr-1.5 size-4" aria-hidden="true" />
      Ganti penyedia
    </Button>
  ) : null;

  const buttons: Record<string, JSX.Element | null> = {
    retry: retryButton,
    devices: deviceButton,
    provider: providerButton,
  };

  const banner = (
    <NotificationBanner
      role="alert"
      {...(onDismiss ? { onDismiss } : {})}
      dismissLabel="Tutup pesan gagal panggilan"
      icon={<AlertTriangle className="size-4" aria-hidden="true" />}
      className={cn(
        "rounded-2xl border border-destructive/40 bg-destructive/15 p-4",
        trapFocus ? undefined : className,
      )}
    >
      <p className="font-semibold">{TITLE[kind]}</p>
      <p className="mt-1 inline-flex items-center rounded-full bg-destructive/25 px-2.5 py-0.5 text-xs font-medium">
        Penyebab: {summary.label}
      </p>
      <p className="mt-1 text-navy-foreground/85">{HINT[kind]}</p>
      {reason ? (
        <p className="mt-1 text-xs text-navy-foreground/70">Detail: {reason}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {order.map((k) => buttons[k]).filter(Boolean)}
      </div>
    </NotificationBanner>
  );

  if (!trapFocus) return banner;
  return (
    <div
      ref={panelRef}
      role="alertdialog"
      aria-modal="true"
      aria-label="Pemulihan panggilan gagal"
      data-call-surface=""
      tabIndex={-1}
      className={cn("outline-none", className)}
    >
      {banner}
    </div>
  );
}