import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BellRing, Loader2, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listDevices,
  notificationsOf,
  removeAllDevices,
  removeDevice,
  type DeviceRow,
  type NotificationsPrefs,
} from "@/lib/api/settings";
import { useUserSettings } from "@/lib/settings/use-settings";
import { getPushStatus } from "@/lib/push/push.functions";
import {
  openFullScreenIntentSettings,
  openNotificationSettings,
  pushCapabilities,
  type NativeCapabilities,
} from "@/lib/push/native";
import { enablePush, refreshPushSession, usePushState } from "@/lib/push/use-push";
import {
  PERM_LABEL,
  STATE_LABEL,
  checkPermission,
  openAppSettings,
  requestPermission,
  type PermKey,
  type PermState,
} from "@/lib/push/permissions";

export const Route = createFileRoute("/settings/notifications")({
  head: () => ({
    meta: [
      { title: "Izin & Notifikasi — TOKOLINK" },
      {
        name: "description",
        content:
          "Kelola preferensi notifikasi TOKOLINK, izin perangkat, dan perangkat penerima push.",
      },
      { property: "og:title", content: "Izin & Notifikasi — TOKOLINK" },
      {
        property: "og:description",
        content: "Pengaturan pesan, panggilan, tugas, penjualan, dan pembayaran.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationSettingsPage,
});

const PERM_KEYS: PermKey[] = ["notifications", "camera", "microphone", "location", "photos"];
const CATEGORY_ROWS: { key: keyof NotificationsPrefs; label: string; desc: string }[] = [
  { key: "chat", label: "Pesan pribadi", desc: "Pesan dan permintaan kontak baru." },
  {
    key: "calls",
    label: "Panggilan",
    desc: "Notifikasi panggilan masuk. Tampilan layar kunci mengikuti izin Android.",
  },
  {
    key: "ledger",
    label: "Hutang & pembayaran",
    desc: "Pembayaran, jatuh tempo, dan persetujuan catatan.",
  },
  { key: "group", label: "Pesan grup", desc: "Pesan baru dari percakapan grup." },
  { key: "tasks", label: "Tugas penyiapan", desc: "Perintah baru dan pembaruan tugas." },
  { key: "sales", label: "Penjualan", desc: "Nota dan pembaruan pesanan." },
];

function stateTone(state: PermState) {
  if (state === "granted") return "bg-success/15 text-success";
  if (state === "denied" || state === "restricted") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}
const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type DevicesState = {
  owner?: string | undefined;
  items: DeviceRow[];
  loading: boolean;
  error: string | null;
};

function NotificationSettingsPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const {
    settings,
    error: settingsError,
    loading,
    saving,
    refresh,
    patch: saveSettings,
  } = useUserSettings(userId);
  const [deviceState, setDeviceState] = useState<DevicesState>({
    items: [],
    loading: true,
    error: null,
  });
  const devices = deviceState.owner === userId ? deviceState.items : [];
  const devicesLoading = deviceState.owner !== userId || deviceState.loading;
  const devicesError = deviceState.owner === userId ? deviceState.error : null;
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [perms, setPerms] = useState<Partial<Record<PermKey, PermState>>>({});
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [permissionBusy, setPermissionBusy] = useState<PermKey | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [caps, setCaps] = useState<NativeCapabilities | null>(null);
  const notif = notificationsOf(settings);
  const push = usePushState();
  const controlsDisabled = loading || saving || !settings || Boolean(settingsError);

  const loadDevices = useCallback(async () => {
    if (!userId) return;
    const owner = userId;
    setDeviceState((s) => ({
      owner,
      items: s.owner === owner ? s.items : [],
      loading: true,
      error: null,
    }));
    try {
      const items = await listDevices();
      if (currentUser.current === owner)
        setDeviceState({ owner, items, loading: false, error: null });
    } catch (e) {
      if (currentUser.current === owner)
        setDeviceState({
          owner,
          items: [],
          loading: false,
          error: messageOf(e, "Gagal memuat perangkat"),
        });
    }
  }, [userId]);

  const refreshPerms = useCallback(async () => {
    const results = await Promise.allSettled(
      PERM_KEYS.map(async (key) => [key, await checkPermission(key)] as const),
    );
    const next: Partial<Record<PermKey, PermState>> = {};
    for (const result of results)
      if (result.status === "fulfilled") next[result.value[0]] = result.value[1];
    setPerms(next);
    setPermissionError(
      results.some((r) => r.status === "rejected")
        ? "Sebagian izin belum dapat diperiksa. Coba periksa ulang."
        : null,
    );
  }, []);

  const refreshPush = useCallback(async () => {
    setConfigured(null);
    setPushError(null);
    try {
      setConfigured((await getPushStatus()).configured);
    } catch (e) {
      setPushError(messageOf(e, "Status server push belum dapat diperiksa."));
    }
    setCaps(await pushCapabilities().catch(() => null));
  }, []);

  useEffect(() => {
    setDeviceBusy(false);
    setEnabling(false);
    void loadDevices();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadDevices();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadDevices]);

  useEffect(() => {
    void refreshPerms();
    void refreshPush();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshPerms();
        void refreshPush();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshPerms, refreshPush]);

  const patch = async (value: Partial<NotificationsPrefs>) => {
    if (controlsDisabled) return;
    const owner = userId;
    try {
      await saveSettings({ notifications: value });
      if (currentUser.current === owner) toast.success("Preferensi notifikasi tersimpan");
    } catch (e) {
      if (currentUser.current === owner) toast.error(messageOf(e, "Gagal menyimpan pengaturan"));
    }
  };

  const ask = async (key: PermKey) => {
    setPermissionBusy(key);
    try {
      if (perms[key] === "denied" || perms[key] === "restricted") {
        if (!(await openAppSettings()))
          toast.info(
            "Buka pengaturan aplikasi atau izin situs pada perangkat ini untuk mengubah izin.",
          );
        return;
      }
      const state = await requestPermission(key);
      setPerms((p) => ({ ...p, [key]: state }));
      if (state === "denied")
        toast.info("Izin belum diberikan. Anda dapat mengubahnya di pengaturan perangkat.");
      else if (state === "unsupported")
        toast.info("Izin ini dikelola saat fitur digunakan atau belum tersedia di perangkat ini.");
    } catch (e) {
      toast.error(messageOf(e, "Gagal meminta izin perangkat"));
    } finally {
      setPermissionBusy(null);
    }
  };

  const revoke = async (id?: string) => {
    if (!userId || deviceBusy) return;
    const owner = userId;
    setDeviceBusy(true);
    try {
      if (id) await removeDevice(id);
      else await removeAllDevices();
      await refreshPushSession(owner);
      if (currentUser.current !== owner) return;
      setDeviceState((s) => ({
        ...s,
        items: s.items.map((d) =>
          !id || d.id === id ? { ...d, push_enabled: false, revoked: true } : d,
        ),
      }));
      toast.success(id ? "Push perangkat dicabut" : "Push seluruh perangkat dicabut");
    } catch (e) {
      if (currentUser.current === owner) toast.error(messageOf(e, "Gagal mencabut push perangkat"));
    } finally {
      if (currentUser.current === owner) setDeviceBusy(false);
    }
  };

  return (
    <AppShell
      nav={false}
      header={
        <MobileHeader
          title="Izin & Notifikasi"
          subtitle="Preferensi akun dan izin perangkat"
          back
        />
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5 pb-12">
        <section className="rounded-2xl border border-border bg-card p-4" aria-live="polite">
          <h1 className="text-base font-semibold">Notifikasi TOKOLINK</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Preferensi disimpan untuk akun Anda dan berlaku di semua perangkat. Izin sistem diatur
            pada setiap perangkat.
          </p>
          {!userId ? (
            <p role="alert" className="mt-3 text-sm">
              Masuk untuk mengelola preferensi akun.
            </p>
          ) : loading ? (
            <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Memuat preferensi…
            </p>
          ) : settingsError ? (
            <div role="alert" className="mt-3 space-y-2">
              <p className="text-sm text-destructive">{settingsError}</p>
              <Button variant="outline" className="min-h-11" onClick={() => void refresh()}>
                Coba muat preferensi lagi
              </Button>
            </div>
          ) : saving ? (
            <p role="status" className="mt-3 text-xs text-muted-foreground">
              Menyimpan preferensi…
            </p>
          ) : settings ? (
            <p className="mt-3 text-xs text-muted-foreground">Preferensi akun sudah dimuat.</p>
          ) : null}
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <BellRing className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Status push perangkat ini</h2>
          </div>
          <Button asChild variant="outline" className="min-h-11 w-full whitespace-normal">
            <Link to="/settings/push-test">Uji notifikasi saat aplikasi ditutup</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Status konfigurasi belum membuktikan pesan sampai. Gunakan uji pengiriman lalu periksa
            hasilnya di perangkat Android.
          </p>
          <ul className="space-y-3">
            {[
              {
                label: "Server pengirim push",
                ok: configured === true,
                pending: configured === null && !pushError,
                unknown: Boolean(pushError),
                hint:
                  pushError ??
                  (configured === null
                    ? "Sedang memeriksa konfigurasi pengirim."
                    : configured
                      ? "Konfigurasi pengirim tersedia di server."
                      : "Perlu konfigurasi pengirim oleh admin."),
              },
              {
                label: "Token perangkat ini terdaftar",
                ok: push.registered,
                pending: false,
                unknown: false,
                hint:
                  push.reason ?? "Pendaftaran token diperlukan agar perangkat dapat menerima push.",
              },
              {
                label: push.native ? "Penerima latar Android terpasang" : "Penerima latar web",
                ok: push.native ? push.receiverInstalled : push.webPush && push.registered,
                pending: false,
                unknown: false,
                hint: "Penerimaan tetap bergantung pada izin, koneksi, pengaturan baterai, dan hasil uji perangkat.",
              },
            ].map((row) => (
              <li key={row.label} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.hint}</p>
                </div>
                <Badge
                  variant="secondary"
                  className={`shrink-0 ${stateTone(row.ok ? "granted" : "prompt")}`}
                >
                  {row.pending
                    ? "Memeriksa…"
                    : row.unknown
                      ? "Belum diketahui"
                      : row.ok
                        ? "Tersedia"
                        : "Belum"}
                </Badge>
              </li>
            ))}
          </ul>
          {pushError ? (
            <Button
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => void refreshPush()}
            >
              Periksa status push lagi
            </Button>
          ) : null}
          {!push.native && !push.webPush ? (
            <p className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
              Push web belum tersedia pada browser atau build ini. Hubungi admin untuk memeriksa
              dukungan dan konfigurasi.
            </p>
          ) : null}
          {userId && (push.native || push.webPush) && !push.registered ? (
            <Button
              disabled={enabling}
              className="min-h-11 w-full whitespace-normal"
              onClick={() => {
                setEnabling(true);
                const owner = userId;
                void enablePush(owner)
                  .then((s) => {
                    if (currentUser.current !== owner) return;
                    setPerms((p) => ({ ...p, notifications: s.permission }));
                    if (s.permission !== "granted") toast.info("Izin notifikasi belum diberikan.");
                    else if (!s.registered) toast.error(s.reason ?? "Pendaftaran perangkat gagal.");
                    else void loadDevices();
                  })
                  .catch((e) => {
                    if (currentUser.current === owner)
                      toast.error(messageOf(e, "Gagal mengaktifkan push"));
                  })
                  .finally(() => {
                    if (currentUser.current === owner) setEnabling(false);
                  });
              }}
            >
              {enabling ? "Mendaftarkan perangkat…" : "Aktifkan notifikasi di perangkat ini"}
            </Button>
          ) : null}
          {settings && !loading ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <div>
                <p className="text-sm font-medium">Aktifkan notifikasi push</p>
                <p className="text-xs text-muted-foreground">
                  Mengatur push untuk seluruh perangkat akun ini.
                </p>
              </div>
              <Switch
                aria-label="Aktifkan notifikasi push"
                checked={notif.push}
                disabled={controlsDisabled}
                onCheckedChange={(v) => void patch({ push: v })}
              />
            </div>
          ) : null}
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Izin perangkat ini</h2>
            <Button variant="ghost" className="min-h-11" onClick={() => void refreshPerms()}>
              <RefreshCw className="size-4" /> Periksa ulang
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Izin diminta ketika fitur digunakan. Pemilih foto dapat bekerja tanpa akses ke seluruh
            berkas.
          </p>
          {permissionError ? (
            <p role="alert" className="text-xs text-destructive">
              {permissionError}
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {PERM_KEYS.map((key) => {
              const state = perms[key];
              return (
                <li key={key} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{PERM_LABEL[key].title}</p>
                    <p className="text-xs text-muted-foreground">{PERM_LABEL[key].desc}</p>
                  </div>
                  <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1.5">
                    <Badge
                      variant="secondary"
                      className={`max-w-full whitespace-normal text-right ${stateTone(state ?? "prompt")}`}
                    >
                      {state
                        ? key === "photos"
                          ? "Pemilih foto"
                          : STATE_LABEL[state]
                        : permissionError
                          ? "Belum diketahui"
                          : "Memeriksa…"}
                    </Badge>
                    {state && state !== "granted" && state !== "unsupported" ? (
                      <Button
                        variant="outline"
                        className="min-h-11 rounded-lg px-3 text-xs"
                        disabled={permissionBusy !== null}
                        aria-label={`${state === "denied" || state === "restricted" ? "Buka pengaturan" : "Izinkan"} ${PERM_LABEL[key].title}`}
                        onClick={() => void ask(key)}
                      >
                        {permissionBusy === key
                          ? "Memproses…"
                          : state === "denied" || state === "restricted"
                            ? "Pengaturan"
                            : "Izinkan"}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {settings && !loading ? (
          <>
            <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Kategori notifikasi</h2>
              <p className="text-xs text-muted-foreground">
                Mengatur push dan daftar pemberitahuan di aplikasi. Pesan serta riwayat tetap
                tersimpan.
              </p>
              <ul className="divide-y divide-border">
                {CATEGORY_ROWS.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.label}</p>
                      <p className="text-xs text-muted-foreground">{row.desc}</p>
                    </div>
                    <Switch
                      aria-label={`Notifikasi ${row.label}`}
                      checked={Boolean(notif[row.key])}
                      disabled={controlsDisabled}
                      onCheckedChange={(v) => void patch({ [row.key]: v })}
                    />
                  </li>
                ))}
              </ul>
            </section>
            <section className="space-y-4 rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Tampilan & bunyi</h2>
              {(
                [
                  {
                    key: "preview",
                    label: "Pratinjau isi pesan",
                    desc: "Matikan agar push menampilkan pemberitahuan umum tanpa isi pesan.",
                  },
                  {
                    key: "sound",
                    label: "Suara push",
                    desc: "Preferensi bunyi untuk push. Channel Android dan mode senyap perangkat tetap berlaku.",
                  },
                  {
                    key: "vibrate",
                    label: "Getar push",
                    desc: "Preferensi getar untuk push. Dukungan browser dan channel Android dapat membatasinya.",
                  },
                  {
                    key: "badge",
                    label: "Lencana jumlah dalam aplikasi",
                    desc: "Tampilkan jumlah pada lonceng dan menu bawah. Lencana ikon Android dikelola sistem.",
                  },
                ] as const
              ).map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.desc}</p>
                  </div>
                  <Switch
                    aria-label={row.label}
                    checked={notif[row.key]}
                    disabled={controlsDisabled}
                    onCheckedChange={(v) => void patch({ [row.key]: v })}
                  />
                </div>
              ))}
              {push.native ? (
                <Button
                  variant="outline"
                  className="min-h-11 w-full whitespace-normal"
                  onClick={() =>
                    void openNotificationSettings()
                      .then((r) => {
                        if (!r.opened)
                          toast.info("Buka pengaturan Android → Aplikasi → TOKOLINK → Notifikasi.");
                      })
                      .catch(() => toast.error("Gagal membuka pengaturan Android"))
                  }
                >
                  Buka channel notifikasi Android
                </Button>
              ) : null}
            </section>
          </>
        ) : null}

        {push.native && caps && !caps.fullScreenIntent ? (
          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Panggilan di layar kunci</h2>
            <p className="text-xs text-muted-foreground">
              Izin layar penuh belum tersedia. Hasil tampilan panggilan perlu diuji pada perangkat
              ini.
            </p>
            <Button
              variant="outline"
              className="min-h-11 w-full whitespace-normal"
              onClick={() =>
                void openFullScreenIntentSettings()
                  .then((r) => {
                    if (!r.opened)
                      toast.info("Pengaturan layar penuh belum dapat dibuka pada perangkat ini.");
                  })
                  .catch(() => toast.error("Gagal membuka pengaturan layar penuh"))
              }
            >
              Atur izin layar penuh
            </Button>
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Perangkat penerima push</h2>
          <p className="text-xs text-muted-foreground">
            Mencabut push menghentikan notifikasi perangkat tersebut. Sesi masuk akun tidak
            dikeluarkan.
          </p>
          {!userId ? (
            <p className="text-xs text-muted-foreground">Masuk untuk melihat perangkat.</p>
          ) : devicesLoading ? (
            <p role="status" className="text-xs text-muted-foreground">
              Memuat perangkat…
            </p>
          ) : devicesError ? (
            <div role="alert" className="space-y-2">
              <p className="text-xs text-destructive">{devicesError}</p>
              <Button variant="outline" className="min-h-11" onClick={() => void loadDevices()}>
                Coba muat perangkat lagi
              </Button>
            </div>
          ) : devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada perangkat terdaftar.</p>
          ) : (
            <ul className="divide-y divide-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{d.name || "Perangkat"}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.platform || "web"} ·{" "}
                        {d.revoked
                          ? "push dicabut"
                          : d.push_enabled
                            ? "push aktif"
                            : "push nonaktif"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 text-destructive"
                    aria-label={`Cabut push ${d.name || "perangkat"}`}
                    disabled={deviceBusy || d.revoked}
                    onClick={() => void revoke(d.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!devicesLoading && !devicesError && devices.some((d) => !d.revoked) ? (
            <Button
              variant="outline"
              className="min-h-11 w-full whitespace-normal text-destructive"
              disabled={deviceBusy}
              onClick={() => void revoke()}
            >
              Cabut push seluruh perangkat
            </Button>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
