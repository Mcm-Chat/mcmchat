import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Copy, Globe, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { checkDomainStatus } from "@/lib/domain/domain.functions";
import {
  DOMAIN_HOST,
  EXPECTED_A,
  EXPECTED_TXT,
  WWW_HOST,
  type DomainStatus,
} from "@/lib/domain/expected";

export const Route = createFileRoute("/settings/domain")({
  head: () => ({
    meta: [
      { title: "Verifikasi Domain — MCM" },
      {
        name: "description",
        content:
          "Wizard verifikasi domain MCM: status TXT _lovable, record A www, nameserver, dan panduan langkah demi langkah.",
      },
      { property: "og:title", content: "Verifikasi Domain — MCM" },
      {
        property: "og:description",
        content: "Pantau status DNS domain kustom MCM dan ikuti panduan penyiapannya.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DomainSettingsPage,
});

const STEPS: { title: string; body: string; copy?: { label: string; value: string } }[] = [
  {
    title: "1. Arahkan nameserver ke Cloudflare",
    body: "Di dashboard registrar (mis. Rumahweb), ganti nameserver domain menjadi nameserver yang ditampilkan pada dashboard Cloudflare. Propagasi bisa memakan waktu hingga beberapa jam.",
  },
  {
    title: "2. Tambahkan record A untuk apex",
    body: `Cloudflare → DNS → Add record. Type A, Name @, IPv4 ${EXPECTED_A}, Proxy status DNS only (awan abu-abu).`,
    copy: { label: "Salin IP", value: EXPECTED_A },
  },
  {
    title: "3. Tambahkan record A untuk www",
    body: `Type A, Name www, IPv4 ${EXPECTED_A}, Proxy status DNS only. Host www akan di-redirect 301 ke apex oleh aplikasi.`,
    copy: { label: "Salin IP", value: EXPECTED_A },
  },
  {
    title: "4. Tambahkan TXT _lovable",
    body: "Type TXT, Name _lovable, TTL Auto, Content seperti di bawah. Record ini membuktikan kepemilikan domain.",
    copy: { label: "Salin nilai TXT", value: EXPECTED_TXT },
  },
  {
    title: "5. Hubungkan domain lalu verifikasi",
    body: `Buka Project Settings → Domains → Connect Domain untuk ${DOMAIN_HOST} dan ${WWW_HOST}, tekan Verify/Complete Setup, lalu jadikan apex sebagai Primary. Sertifikat HTTPS terbit otomatis setelah verifikasi berhasil.`,
  },
];

function DomainSettingsPage() {
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await checkDomainStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memeriksa status domain");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Disalin ke papan klip");
    } catch {
      toast.error("Tidak bisa menyalin otomatis, salin manual ya");
    }
  };

  const done = status?.checks.filter((c) => c.ok).length ?? 0;
  const total = status?.checks.length ?? 0;

  return (
    <AppShell
      header={
        <MobileHeader
          title="Verifikasi domain"
          subtitle={DOMAIN_HOST}
          right={
            <Button
              size="sm"
              variant="ghost"
              className="rounded-xl"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
          }
        />
      }
    >
      <div className="space-y-4 p-4">
        <section className="card-soft space-y-3 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Globe className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-base font-semibold">Status DNS domain kustom</h1>
              <p className="text-xs text-muted-foreground">
                {status
                  ? `${done}/${total} pemeriksaan lolos • dicek ${new Date(status.checkedAt).toLocaleTimeString("id-ID")}`
                  : "Memeriksa resolver publik…"}
              </p>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="space-y-2">
            {loading && !status && (
              <p className="text-sm text-muted-foreground">Menghubungi resolver DNS…</p>
            )}
            {status?.checks.map((c) => (
              <div key={c.key} className="rounded-xl bg-muted/50 p-3">
                <div className="flex items-start gap-2">
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{c.label}</p>
                      <Badge
                        variant="secondary"
                        className={
                          c.ok
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-destructive/15 text-destructive"
                        }
                      >
                        {c.ok ? "OK" : "Belum"}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      Diharapkan: {c.expected}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      Terlihat: {c.found.length ? c.found.join(", ") : "tidak ada record"}
                    </p>
                    {!c.ok && <p className="mt-1 text-xs text-foreground/80">{c.hint}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card-soft space-y-3 p-4">
          <h2 className="text-sm font-semibold">Panduan langkah demi langkah</h2>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.title} className="rounded-xl border border-border p-3">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
                {s.copy && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2 py-1 text-[11px]">
                      {s.copy.value}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 rounded-lg"
                      onClick={() => void copy(s.copy!.value)}
                    >
                      <Copy className="mr-1 size-3.5" />
                      {s.copy.label}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Perubahan DNS butuh waktu propagasi. Tekan tombol segarkan di kanan atas untuk memeriksa
            ulang kapan saja.
          </p>
        </section>
      </div>
    </AppShell>
  );
}