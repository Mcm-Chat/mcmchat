import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { useAuth } from "@/lib/auth";
import {
  clearDiagnosticRuns,
  listDiagnosticRuns,
  recordDiagnosticRun,
  type DiagnosticRun,
} from "@/lib/api/call-diagnostics";
import { Button } from "@/components/ui/button";
import { getCallConfig } from "@/lib/calls/calls.functions";
import { issueDiagnosticToken } from "@/lib/calls/diagnostics.functions";
import {
  mediaDevicesCheck,
  overallStatus,
  permissionCheck,
  providerCheck,
  readPermission,
  result,
  runLiveKitConnectTest,
  secureContextCheck,
  testLocalDevices,
  type CheckStatus,
  type DiagnosticResult,
} from "@/lib/calls/diagnostics";

export const Route = createFileRoute("/settings/calls")({
  head: () => ({
    meta: [
      { title: "Diagnostik Panggilan — MCM" },
      {
        name: "description",
        content:
          "Periksa kesiapan panggilan MCM: penyedia panggilan, koneksi HTTPS, izin mikrofon dan kamera, serta tes perangkat.",
      },
      { property: "og:title", content: "Diagnostik Panggilan — MCM" },
      {
        property: "og:description",
        content: "Cek penyedia panggilan, HTTPS, izin, dan perangkat sebelum menelepon.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CallDiagnosticsPage,
});

const ICON: Record<CheckStatus, typeof CheckCircle2> = {
  pass: CheckCircle2,
  fail: XCircle,
  warn: TriangleAlert,
  pending: Loader2,
};

const TONE: Record<CheckStatus, string> = {
  pass: "text-success",
  fail: "text-destructive",
  warn: "text-warning",
  pending: "text-muted-foreground",
};

const SUMMARY: Record<CheckStatus, string> = {
  pass: "Panggilan siap digunakan.",
  fail: "Ada masalah yang membuat panggilan gagal.",
  warn: "Panggilan bisa dicoba, tapi ada hal yang perlu diperhatikan.",
  pending: "Sedang memeriksa…",
};

function CallDiagnosticsPage() {
  const [checks, setChecks] = useState<DiagnosticResult[]>([]);
  const [running, setRunning] = useState(false);
  const [deviceTest, setDeviceTest] = useState<DiagnosticResult | null>(null);
  const [configured, setConfigured] = useState(false);
  const [netTest, setNetTest] = useState<DiagnosticResult | null>(null);
  const [netRunning, setNetRunning] = useState(false);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [history, setHistory] = useState<DiagnosticRun[]>([]);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    try {
      setHistory(await listDiagnosticRuns());
    } catch {
      /* riwayat opsional; kegagalan muat tidak memblokir diagnostik */
    }
  }, [userId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const run = useCallback(async () => {
    setRunning(true);
    const items: DiagnosticResult[] = [];
    try {
      const cfg = await getCallConfig();
      setConfigured(Boolean(cfg.configured));
      items.push(providerCheck(Boolean(cfg.configured), cfg.code));
    } catch {
      setConfigured(false);
      items.push(
        result(
          "provider",
          "Konfigurasi penyedia",
          "fail",
          "Server tidak dapat dihubungi.",
          "Periksa koneksi internet lalu coba lagi.",
        ),
      );
    }
    items.push(secureContextCheck(window.isSecureContext, window.location.hostname));
    items.push(mediaDevicesCheck(Boolean(navigator.mediaDevices?.getUserMedia)));
    items.push(permissionCheck("mic", await readPermission("microphone")));
    items.push(permissionCheck("camera", await readPermission("camera")));
    setChecks(items);
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const status = running && checks.length === 0 ? "pending" : overallStatus(checks);

  return (
    <AppShell header={<MobileHeader title="Diagnostik panggilan" back />}>
      <div className="space-y-4 p-4">
        <section className="rounded-2xl border bg-card p-4">
          <h1 className="text-base font-semibold">Kesiapan panggilan</h1>
          <p className={`mt-1 text-sm ${TONE[status]}`}>{SUMMARY[status]}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3 rounded-xl"
            onClick={() => void run()}
            disabled={running}
          >
            <RefreshCw className={`mr-1.5 size-4 ${running ? "animate-spin" : ""}`} />
            Periksa ulang
          </Button>
        </section>

        <ul className="space-y-2">
          {checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <li key={c.id} className="flex gap-3 rounded-2xl border bg-card p-3">
                <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[c.status]}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                  {c.action && (
                    <p className="mt-1 text-xs text-foreground/80">Langkah: {c.action}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">Tes koneksi LiveKit</h2>
            <p className="text-xs text-muted-foreground">
              Menyambung sebentar ke ruang diagnostik acak (tanpa suara, tanpa video, tanpa data)
              lalu memutusnya. Riwayat panggilan tidak berubah.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-xl"
            disabled={!configured || netRunning}
            onClick={() => {
              setNetRunning(true);
              void runLiveKitConnectTest(() => issueDiagnosticToken())
                .then(async (r) => {
                  setNetTest(r);
                  if (!userId) return;
                  try {
                    await recordDiagnosticRun(userId, r);
                    await loadHistory();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Riwayat gagal disimpan");
                  }
                })
                .finally(() => setNetRunning(false));
            }}
          >
            {netRunning && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Tes koneksi LiveKit
          </Button>
          {!configured && (
            <p className="text-xs text-muted-foreground">
              Tes dinonaktifkan: penyedia panggilan belum terhubung (provider_unconfigured).
            </p>
          )}
          {netTest && (
            <p className={`text-xs ${TONE[netTest.status]}`}>
              {netTest.status === "pass" ? "Lulus" : "Gagal"}: {netTest.detail}
              {netTest.action ? ` Langkah: ${netTest.action}` : ""}
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Riwayat diagnostik</h2>
              <p className="text-xs text-muted-foreground">
                Hasil tes koneksi tersimpan di akun Anda (status, latensi, kode error).
              </p>
            </div>
            {history.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-xl text-destructive"
                onClick={() => {
                  if (!userId) return;
                  void clearDiagnosticRuns(userId)
                    .then(() => setHistory([]))
                    .catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "Gagal menghapus"),
                    );
                }}
              >
                Hapus
              </Button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Belum ada hasil tersimpan. Jalankan tes koneksi di atas.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {history.map((h) => (
                <li key={h.id} className="flex items-start gap-3 py-2">
                  <span
                    className={`mt-1 size-2 shrink-0 rounded-full ${
                      h.status === "pass"
                        ? "bg-success"
                        : h.status === "warn"
                          ? "bg-warning"
                          : "bg-destructive"
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">
                      {h.status === "pass" ? "Lulus" : h.status === "warn" ? "Peringatan" : "Gagal"}
                      {h.latency_ms !== null ? ` · ${h.latency_ms} ms` : ""}
                      {h.code && h.code !== "ok" ? ` · ${h.code}` : ""}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{h.detail}</p>
                  </div>
                  <time className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">Tes perangkat</h2>
            <p className="text-xs text-muted-foreground">
              Membuka mikrofon/kamera sebentar lalu menutupnya kembali. Tidak ada rekaman disimpan.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-xl"
              onClick={() => void testLocalDevices(false).then(setDeviceTest)}
            >
              Tes mikrofon
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="rounded-xl"
              onClick={() => void testLocalDevices(true).then(setDeviceTest)}
            >
              Tes kamera
            </Button>
          </div>
          {deviceTest && (
            <p className={`text-xs ${TONE[deviceTest.status]}`}>
              {deviceTest.label}: {deviceTest.detail}
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
