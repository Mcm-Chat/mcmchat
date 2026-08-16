/**
 * Kerangka (skeleton) bersama untuk halaman berat yang dimuat malas.
 * Semua rute berat memakai bentuk yang sama — bilah header, isi, dan
 * navigasi bawah — supaya perpindahan halaman tidak pernah menampilkan
 * layar kosong. Komponen ini sengaja ringan: tanpa query, tanpa konteks.
 */
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function HeaderBar() {
  return (
    <div className="flex h-14 items-center gap-3 border-b border-border/60 bg-background px-4">
      <Skeleton className="size-8 rounded-xl" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-40" />
      </div>
      <Skeleton className="size-8 rounded-xl" />
    </div>
  );
}

function NavBar() {
  return (
    <div className="flex h-16 items-center justify-around border-t border-border/60 bg-background px-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5">
          <Skeleton className="size-5 rounded-md" />
          <Skeleton className="h-2 w-8" />
        </div>
      ))}
    </div>
  );
}

function ListRows({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          {avatar && <Skeleton className="size-12 rounded-full" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Kerangka umum satu halaman aplikasi (header + daftar + navigasi). */
export function PageSkeleton({
  rows = 6,
  avatar = true,
  nav = true,
  label = "Memuat halaman…",
}: {
  rows?: number | undefined;
  avatar?: boolean | undefined;
  nav?: boolean | undefined;
  label?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-dvh flex-col bg-background"
    >
      <span className="sr-only">{label}</span>
      <HeaderBar />
      <div className="flex-1 overflow-hidden">
        <ListRows rows={rows} avatar={avatar} />
      </div>
      {nav && <NavBar />}
    </div>
  );
}

/** Kerangka layar panggilan: avatar besar, status, dan baris tombol kontrol. */
export function CallSkeleton({ label = "Menyiapkan panggilan…" }: { label?: string | undefined }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-dvh flex-col items-center justify-between bg-background px-6 py-10"
    >
      <span className="sr-only">{label}</span>
      <div className="flex w-full items-center justify-between">
        <Skeleton className="size-9 rounded-xl" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="size-9 rounded-xl" />
      </div>
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="grid w-full max-w-xs grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/** Kerangka halaman keuangan/ledger: kartu ringkasan lalu daftar transaksi. */
export function LedgerSkeleton({ nav = true }: { nav?: boolean | undefined }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-dvh flex-col bg-background"
    >
      <span className="sr-only">Memuat data keuangan…</span>
      <HeaderBar />
      <div className="flex-1 space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-9 w-full rounded-xl" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </div>
      {nav && <NavBar />}
    </div>
  );
}

/**
 * Penanda muat untuk modul overlay (pemindai QR, editor foto) yang diunduh
 * saat tombol ditekan — mengisi layar sehingga tidak ada jeda kosong.
 */
export function OverlayLoading({
  label = "Menyiapkan…",
  className,
}: {
  label?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm",
        className,
      )}
    >
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-[13px] text-muted-foreground">{label}</p>
    </div>
  );
}