import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BellRing, CheckCircle2, Loader2, PhoneCall, Smartphone, XCircle } from "lucide-react";
import { listDevices, type DeviceRow } from "@/lib/api/settings";
import { getPushStatus, sendPushSelfTest } from "@/lib/push/push.functions";
import { missingWebPushKeys } from "@/lib/push/web-config";
import { checkPermission, type PermState } from "@/lib/push/permissions";

export const Route = createFileRoute("/settings/push-test")({
  head: () => ({
    meta: [
      { title: "Uji Notifikasi Tertutup — MCM" },
      {
        name: "description",
        content:
          "Kirim push uji pesan dan panggilan ke perangkat Anda sendiri untuk membuktikan notifikasi tetap muncul saat aplikasi ditutup total.",
      },
      { property: "og:title", content: "Uji Notifikasi Tertutup — MCM" },
      {
        property: "og:description",
        content: "Bukti nyata jalur push MCM: pesan dan panggilan saat aplikasi force-quit.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PushTestPage,
});

type Variant = "message" | "call";

type LogRow = {
  at: string;
  variant: Variant;
  ok: boolean;
  detail: string;
};

const VARIANT_LABEL: Record<Variant, string> = {
  message: "Pesan",
  call: "Panggilan",
};

function wib(d: Date) {
  return new Intl.DateTimeFormat("id-ID", {
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

function PushTestPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [perm, setPerm] = useState<PermState | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [configReason, setConfigReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<Variant | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const missingKeys = missingWebPushKeys();

  const refresh = useCallback(async () => {
    const [d, p, s] = await Promise.all([
      listDevices().catch(() => [] as DeviceRow[]),
      checkPermission("notifications").catch(() => null),
      getPushStatus().catch(() => null),
    ]);
    setDevices(d.filter((x) => !x.revoked && x.push_enabled));
    setPerm(p);
    if (s) {
      setConfigured(s.configured);
      setConfigReason(s.configured ? null : (s.reason ?? null));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = async (variant: Variant) => {
    setBusy(variant);
    try {
      const res = await sendPushSelfTest({ data: { variant } });
      const ok = res.configured && res.sent > 0;
      const detail = !res.configured
        ? (res.reason ?? "Server push belum terhubung")
        : res.devices === 0
          ? "Tidak ada perangkat aktif yang menerima kategori ini"
          : `${res.sent} terkirim • ${res.failed} gagal • ${res.devices} perangkat`;
      setLog((prev) => [{ at: wib(new Date()), variant, ok, detail }, ...prev].slice(0, 20));
      if (ok) toast.success(`Push uji ${VARIANT_LABEL[variant].toLowerCase()} dikirim`);
      else toast.error(detail);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Gagal mengirim push uji";
      setLog((prev) => [{ at: wib(new Date()), variant, ok: false, detail }, ...prev].slice(0, 20));
      toast.error(detail);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const blocked =
    configured === false || devices.length === 0 || (perm !== null && perm !== "granted");

  return (
    <AppShell header={<MobileHeader title="Uji notifikasi tertutup" back />}>
      <div className="space-y-4 p-4 pb-24">
        <section className="rounded-xl border border-border bg-card p-4">
          <h1 className="text-base font-semibold text-foreground">
            Buktikan notifikasi saat aplikasi ditutup
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tombol di bawah mengirim push sungguhan lewat server ke perangkat Anda sendiri — bukan
            notifikasi lokal. Kalau notifikasi muncul setelah aplikasi ditutup total, jalur latar
            belakang terbukti hidup.
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Prasyarat</h2>
          <StatusRow
            ok={configured === true}
            pending={configured === null}
            label="Server push terhubung"
            detail={configured === false ? (configReason ?? "Kredensial server belum lengkap") : ""}
          />
          <StatusRow
            ok={perm === "granted"}
            pending={perm === null}
            label="Izin notifikasi perangkat"
            detail={perm && perm !== "granted" ? "Aktifkan di Pengaturan → Notifikasi" : ""}
          />
          <StatusRow
            ok={devices.length > 0}
            pending={false}
            label={`Perangkat terdaftar (${devices.length})`}
            detail={devices.length === 0 ? "Aktifkan notifikasi dulu agar perangkat terdaftar" : ""}
          />
          {missingKeys.length > 0 ? (
            <StatusRow
              ok={false}
              pending={false}
              label="Konfigurasi web push"
              detail={`Belum lengkap: ${missingKeys.join(", ")}`}
            />
          ) : null}
          {blocked ? (
            <Button asChild variant="outline" size="sm" className="mt-2 w-full">
              <Link to="/settings/notifications">Buka pengaturan notifikasi</Link>
            </Button>
          ) : null}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Langkah uji</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Tutup aplikasi sepenuhnya (geser dari daftar aplikasi terbaru).</li>
            <li>Tunggu 5 detik, lalu buka lagi halaman ini dan tekan tombol uji.</li>
            <li>
              Atau minta orang lain menekan tombol dari perangkat Anda yang lain — uji ini mengirim
              ke semua perangkat akun Anda sekaligus.
            </li>
            <li>Catat apakah notifikasi muncul di bilah status saat aplikasi tertutup.</li>
          </ol>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => void send("message")} disabled={busy !== null}>
              {busy === "message" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <BellRing className="mr-2 size-4" />
              )}
              Uji pesan
            </Button>
            <Button
              variant="secondary"
              onClick={() => void send("call")}
              disabled={busy !== null}
            >
              {busy === "call" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <PhoneCall className="mr-2 size-4" />
              )}
              Uji panggilan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Uji panggilan memakai channel panggilan (prioritas tertinggi + dering), tetapi tidak
            memalsukan panggilan masuk — tidak ada layar dering palsu.
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Perangkat penerima</h2>
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada perangkat aktif.</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{d.name}</span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {d.platform}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Riwayat pengiriman</h2>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada uji dijalankan.</p>
          ) : (
            <ul className="space-y-2">
              {log.map((row, i) => (
                <li key={`${row.at}-${i}`} className="flex items-start gap-2 text-sm">
                  {row.ok ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">
                      {VARIANT_LABEL[row.variant]} • {row.at} WIB
                    </p>
                    <p className="text-xs text-muted-foreground">{row.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Status di sini hanya membuktikan server berhasil mengirim ke FCM. Bukti akhir tetap
            notifikasi yang benar-benar muncul di layar perangkat Anda.
          </p>
        </section>
      </div>
    </AppShell>
  );
}

function StatusRow(props: { ok: boolean; pending: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {props.pending ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : props.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-foreground">{props.label}</p>
        {props.detail ? <p className="text-xs text-muted-foreground">{props.detail}</p> : null}
      </div>
    </div>
  );
}
