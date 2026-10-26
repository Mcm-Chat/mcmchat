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
import { useAuth } from "@/lib/auth";
import { isNative } from "@/lib/push/native";

export const Route = createFileRoute("/settings/push-test")({
  head: () => ({
    meta: [
      { title: "Uji Notifikasi Tertutup — TOKOLINK" },
      {
        name: "description",
        content:
          "Kirim push uji pesan dan panggilan ke perangkat Anda sendiri, lalu periksa penerimaannya pada perangkat tujuan.",
      },
      { property: "og:title", content: "Uji Notifikasi Tertutup — TOKOLINK" },
      {
        property: "og:description",
        content:
          "Periksa pengiriman push TOKOLINK dan uji penerimaan notifikasi pada perangkat Anda.",
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
  const { user } = useAuth();
  return <AccountPushTest key={user?.id ?? "signed-out"} userId={user?.id} />;
}

function AccountPushTest({ userId }: { userId: string | undefined }) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [perm, setPerm] = useState<PermState | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [configReason, setConfigReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<Variant | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const missingKeys = isNative() ? [] : missingWebPushKeys();
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadErrors([]);
    const [d, p, s] = await Promise.allSettled([
      listDevices(),
      checkPermission("notifications"),
      getPushStatus(),
    ]);
    const errors: string[] = [];
    if (d.status === "fulfilled") setDevices(d.value.filter((x) => !x.revoked && x.push_enabled));
    else {
      setDevices([]);
      errors.push("Daftar perangkat gagal dimuat.");
    }
    if (p.status === "fulfilled") setPerm(p.value);
    else {
      setPerm(null);
      errors.push("Status izin perangkat gagal diperiksa.");
    }
    if (s.status === "fulfilled") {
      setConfigured(s.value.configured);
      setConfigReason(s.value.configured ? null : (s.value.reason ?? null));
    } else {
      setConfigured(null);
      errors.push("Server push belum dapat diperiksa.");
    }
    setLoadErrors(errors);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    const onResume = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("resume", onResume);
    return () => {
      window.removeEventListener("focus", onResume);
      document.removeEventListener("resume", onResume);
    };
  }, [refresh]);

  const send = async (variant: Variant) => {
    if (
      !userId ||
      loading ||
      configured !== true ||
      devices.length === 0 ||
      loadErrors.length > 0 ||
      busy
    )
      return;
    setBusy(variant);
    try {
      const res = await sendPushSelfTest({ data: { variant } });
      const ok = res.configured && res.sent > 0;
      const detail = !res.configured
        ? (res.reason ?? "Server push belum terhubung")
        : res.devices === 0
          ? "Tidak ada perangkat aktif yang menerima kategori ini"
          : `${res.sent} diterima FCM • ${res.failed} gagal • ${res.devices} perangkat; penerimaan belum dikonfirmasi`;
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
    !userId || loading || loadErrors.length > 0 || configured !== true || devices.length === 0;

  return (
    <AppShell header={<MobileHeader title="Uji notifikasi tertutup" back />}>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4 pb-24">
        <section className="rounded-xl border border-border bg-card p-4">
          <h1 className="text-base font-semibold text-foreground">
            Uji pengiriman dan penerimaan notifikasi
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tombol di bawah mengirim push sungguhan lewat server ke perangkat Anda sendiri — bukan
            notifikasi lokal. Hasil kirim server belum membuktikan notifikasi tampil di perangkat.
            Periksa penerimaan pesan dan panggilan secara terpisah.
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Prasyarat</h2>
          {!userId ? <p role="status">Masuk untuk menguji notifikasi akun Anda.</p> : null}
          {loadErrors.length > 0 ? (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              {loadErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !userId}
            onClick={() => void refresh()}
          >
            {loading ? "Memeriksa…" : "Periksa ulang"}
          </Button>
          <StatusRow
            ok={configured === true}
            pending={loading && configured === null}
            label="Server push terhubung"
            detail={configured === false ? (configReason ?? "Kredensial server belum lengkap") : ""}
          />
          <StatusRow
            ok={perm === "granted"}
            pending={loading && perm === null}
            label="Izin notifikasi perangkat"
            detail={perm && perm !== "granted" ? "Aktifkan di Pengaturan → Notifikasi" : ""}
          />
          <StatusRow
            ok={devices.length > 0}
            pending={loading}
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
            <li>
              Masuk dengan akun yang sama pada dua perangkat; aktifkan notifikasi pada perangkat
              tujuan.
            </li>
            <li>
              Di perangkat tujuan, pindahkan aplikasi ke latar belakang atau geser dari daftar
              aplikasi terbaru. Jangan buka kembali selama pengujian.
            </li>
            <li>
              Tekan tombol uji dari perangkat kedua. Pengiriman menyasar perangkat aktif milik akun
              ini.
            </li>
            <li>
              Periksa apakah notifikasi muncul di perangkat tujuan dan apakah ketuk notifikasi
              membuka halaman yang tepat.
            </li>
          </ol>
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <Button onClick={() => void send("message")} disabled={busy !== null || blocked}>
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
              disabled={busy !== null || blocked}
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
            membuat panggilan nyata. Uji ini belum membuktikan dering panggilan, audio/video, atau
            layar penuh. Android yang dihentikan paksa melalui Setelan dapat menahan push sampai
            aplikasi dibuka kembali.
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Perangkat penerima</h2>
          {loading ? (
            <p role="status" className="text-sm">
              Memuat perangkat…
            </p>
          ) : loadErrors.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Periksa ulang untuk memastikan daftar perangkat.
            </p>
          ) : devices.length === 0 ? (
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
