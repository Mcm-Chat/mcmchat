import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { getCallConfig } from "@/lib/calls/calls.functions";
import {
  mediaDevicesCheck,
  overallStatus,
  permissionCheck,
  providerCheck,
  readPermission,
  result,
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
  pass: "text-emerald-600",
  fail: "text-destructive",
  warn: "text-amber-600",
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

  const run = useCallback(async () => {
    setRunning(true);
    const items: DiagnosticResult[] = [];
    try {
      const cfg = await getCallConfig();
      items.push(providerCheck(Boolean(cfg.configured)));
    } catch {
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
                  {c.action && <p className="mt-1 text-xs text-foreground/80">Langkah: {c.action}</p>}
                </div>
              </li>
            );
          })}
        </ul>

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