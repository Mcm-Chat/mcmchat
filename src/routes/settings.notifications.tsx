import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BellRing, Loader2, Smartphone, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getSettings,
  listDevices,
  notificationsOf,
  removeDevice,
  updateSettings,
  type DeviceRow,
  type NotificationsPrefs,
  type UserSettingsRow,
} from "@/lib/api/settings";
import { getPushStatus } from "@/lib/push/push.functions";
import {
  openFullScreenIntentSettings,
  pushCapabilities,
  type NativeCapabilities,
} from "@/lib/push/native";
import { enablePush, usePushChannels, usePushState } from "@/lib/push/use-push";
import { missingWebPushKeys } from "@/lib/push/web-config";
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
      { title: "Izin & Notifikasi — MCM" },
      {
        name: "description",
        content:
          "Atur izin Android, channel notifikasi MCM, pratinjau pesan, serta perangkat yang menerima push.",
      },
      { property: "og:title", content: "Izin & Notifikasi — MCM" },
      {
        property: "og:description",
        content: "Kontrol penuh atas notifikasi chat, tugas, penjualan, dan hutang.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationSettingsPage,
});

const PERM_KEYS: PermKey[] = ["notifications", "camera", "microphone", "location", "photos"];

const CATEGORY_ROWS: { key: keyof NotificationsPrefs; label: string; desc: string }[] = [
  {
    key: "chat",
    label: "Pesan pribadi",
    desc: "Channel: Pesan • prioritas tinggi, balas cepat dari notifikasi",
  },
  {
    key: "group",
    label: "Pesan grup",
    desc: "Channel: Grup • diringkas jadi satu tumpukan per grup",
  },
  {
    key: "calls",
    label: "Panggilan",
    desc: "Channel: Panggilan • dering penuh dan tampil di layar kunci",
  },
  {
    key: "tasks",
    label: "Tugas penyiapan",
    desc: "Channel: Tugas • perintah baru dan tugas selesai",
  },
  { key: "sales", label: "Penjualan", desc: "Channel: Penjualan • nota dan pesanan baru" },
  {
    key: "ledger",
    label: "Hutang & pembayaran",
    desc: "Channel: Keuangan • pembayaran dan jatuh tempo",
  },
];

function stateTone(state: PermState) {
  if (state === "granted") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (state === "denied" || state === "restricted") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
}

function NotificationSettingsPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [settings, setSettings] = useState<UserSettingsRow | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [perms, setPerms] = useState<Record<string, PermState>>({});
  const missingKeys: string[] = missingWebPushKeys();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState<NativeCapabilities | null>(null);
  const notif = notificationsOf(settings);
  const push = usePushState();
  usePushChannels({ sound: notif.sound, vibrate: notif.vibrate });

  const refreshPerms = useCallback(async () => {
    const entries = await Promise.all(
      PERM_KEYS.map(async (k) => [k, await checkPermission(k)] as const),
    );
    setPerms(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (!userId) return;
    void getSettings(userId)
      .then(setSettings)
      .catch(() => undefined);
    void listDevices()
      .then(setDevices)
      .catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    void refreshPerms();
    void getPushStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
    void pushCapabilities()
      .then(setCaps)
      .catch(() => setCaps(null));
  }, [refreshPerms]);

  const patch = async (value: Partial<NotificationsPrefs>) => {
    if (!userId) return;
    setBusy(true);
    try {
      setSettings(await updateSettings(userId, { notifications: value }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan pengaturan");
    } finally {
      setBusy(false);
    }
  };

  const ask = async (key: PermKey) => {
    const before = perms[key];
    const state = await requestPermission(key);
    setPerms((p) => ({ ...p, [key]: state }));
    if (state === "denied" && before === "denied") {
      const opened = await openAppSettings();
      if (!opened) toast.info("Buka Setelan Android → Aplikasi → MCM untuk mengubah izin ini.");
    }
  };

  const revoke = async (id: string) => {
    try {
      await removeDevice(id);
      setDevices((d) => d.filter((x) => x.id !== id));
      toast.success("Perangkat dikeluarkan dan token push dicabut");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengeluarkan perangkat");
    }
  };

  /** Opsi eksplisit: cabut push di seluruh perangkat akun ini. */
  const revokeAll = async () => {
    try {
      const { removeAllDevices } = await import("@/lib/api/settings");
      await removeAllDevices();
      setDevices((d) => d.map((x) => ({ ...x, push_enabled: false, revoked: true })));
      toast.success("Semua perangkat dikeluarkan");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengeluarkan perangkat");
    }
  };

  return (
    <AppShell
      nav={false}
      header={
        <MobileHeader title="Izin & Notifikasi" subtitle="Kontrol push, channel, dan izin" back />
      }
    >
      <div className="space-y-5 px-4 py-5 pb-12">
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <BellRing className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Status push perangkat</h2>
          </div>
          {/* Tiga kapabilitas TERPISAH — tidak ada klaim gabungan yang menyesatkan. */}
          <ul className="space-y-2">
            {[
              {
                label: "Server pengirim push (FCM)",
                ok: configured === true,
                pending: configured === null,
                hint: "Dikonfigurasi admin lewat kredensial server.",
              },
              {
                label: "Token perangkat ini terdaftar",
                ok: push.registered,
                pending: false,
                hint: push.native
                  ? (push.reason ?? "Aktifkan notifikasi agar perangkat terdaftar.")
                  : push.webPush
                    ? (push.reason ?? "Aktifkan notifikasi agar browser/PWA ini terdaftar.")
                    : (push.reason ?? "Push web belum dikonfigurasi di build ini."),
              },
              {
                label: push.native
                  ? "Penerima latar native terpasang"
                  : "Penerima latar web (service worker)",
                ok: push.native ? push.receiverInstalled : push.webPush && push.registered,
                pending: false,
                hint: (push.native ? push.receiverInstalled : push.webPush && push.registered)
                  ? "Pesan tetap masuk saat aplikasi ditutup."
                  : "Belum aktif, jadi pengiriman saat aplikasi ditutup belum dijamin.",
              },
            ].map((row) => (
              <li key={row.label} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.hint}</p>
                </div>
                <Badge
                  variant="secondary"
                  className={
                    row.pending
                      ? "bg-muted text-muted-foreground"
                      : stateTone(row.ok ? "granted" : "prompt")
                  }
                >
                  {row.pending ? "Memeriksa…" : row.ok ? "Aktif" : "Belum"}
                </Badge>
              </li>
            ))}
          </ul>
          {!push.native && !push.webPush ? (
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium">Push web belum aktif di build ini</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nilai konfigurasi Firebase Web berikut masih kosong, sehingga notifikasi saat
                aplikasi ditutup tidak bisa dikirim ke browser/PWA:
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {missingKeys.map((k) => (
                  <li key={k}>{k}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {userId && (push.native || push.webPush) && !push.registered ? (
            <Button
              size="sm"
              className="w-full rounded-xl"
              onClick={() => {
                void enablePush(userId).then((s) => {
                  setPerms((p) => ({ ...p, notifications: s.permission }));
                  if (s.permission !== "granted") toast.info("Izin notifikasi belum diberikan.");
                  else if (!s.registered) toast.error(s.reason ?? "Pendaftaran perangkat gagal.");
                });
              }}
            >
              Aktifkan notifikasi di perangkat ini
            </Button>
          ) : null}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <p className="text-sm font-medium">Aktifkan notifikasi push</p>
              <p className="text-xs text-muted-foreground">
                Matikan untuk menghentikan seluruh push ke perangkat Anda.
              </p>
            </div>
            <Switch
              checked={notif.push}
              disabled={busy}
              onCheckedChange={(v) => void patch({ push: v })}
            />
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Izin aplikasi</h2>
          <p className="text-xs text-muted-foreground">
            MCM meminta izin hanya saat fitur dipakai. Tidak ada lokasi latar belakang dan tidak ada
            akses ke seluruh berkas.
          </p>
          <ul className="divide-y divide-border">
            {PERM_KEYS.map((key) => {
              const state = perms[key] ?? "unsupported";
              return (
                <li key={key} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{PERM_LABEL[key].title}</p>
                    <p className="text-xs text-muted-foreground">{PERM_LABEL[key].desc}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="secondary" className={stateTone(state)}>
                      {STATE_LABEL[state]}
                    </Badge>
                    {state !== "granted" && state !== "unsupported" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => void ask(key)}
                      >
                        Izinkan
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Channel notifikasi</h2>
          <ul className="divide-y divide-border">
            {CATEGORY_ROWS.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.desc}</p>
                </div>
                <Switch
                  checked={Boolean(notif[row.key])}
                  disabled={busy || !notif.push}
                  onCheckedChange={(v) =>
                    void patch({ [row.key]: v } as Partial<NotificationsPrefs>)
                  }
                />
              </li>
            ))}
          </ul>
        </section>

        {caps && !caps.fullScreenIntent ? (
          <section className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Panggilan di layar kunci</h2>
            <p className="text-xs text-muted-foreground">
              Android membatasi tampilan panggilan layar penuh untuk aplikasi ini. Notifikasi
              panggilan tetap muncul sebagai pop-up, tetapi tidak membuka layar panggilan otomatis.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full rounded-lg text-xs"
              onClick={() => void openFullScreenIntentSettings()}
            >
              Izinkan tampilan layar penuh
            </Button>
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Tampilan notifikasi</h2>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Pratinjau isi pesan</p>
              <p className="text-xs text-muted-foreground">
                Matikan agar layar kunci hanya menampilkan “Pesan baru”.
              </p>
            </div>
            <Switch
              checked={notif.preview}
              disabled={busy}
              onCheckedChange={(v) => void patch({ preview: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Suara</p>
            <Switch
              checked={notif.sound}
              disabled={busy}
              onCheckedChange={(v) => void patch({ sound: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Getar</p>
            <Switch
              checked={notif.vibrate}
              disabled={busy}
              onCheckedChange={(v) => void patch({ vibrate: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Lencana jumlah belum dibaca</p>
            <Switch
              checked={notif.badge}
              disabled={busy}
              onCheckedChange={(v) => void patch({ badge: v })}
            />
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Perangkat penerima push</h2>
          {devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada perangkat terdaftar.</p>
          ) : (
            <ul className="divide-y divide-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.name || "Perangkat"}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.platform ?? "web"} • aktif{" "}
                        {new Date(d.last_active_at ?? d.created_at).toLocaleDateString("id-ID")}
                        {d.revoked ? " • dicabut" : d.push_enabled ? "" : " • push nonaktif"}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => void revoke(d.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {devices.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full rounded-lg text-xs text-destructive"
              onClick={() => void revokeAll()}
            >
              Keluar dari semua perangkat
            </Button>
          ) : null}
        </section>

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Menyimpan…
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
