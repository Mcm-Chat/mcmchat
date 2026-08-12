import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Bell,
  Camera,
  Eye,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Phone,
  Shield,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { PinCard } from "@/components/mcm/pin-card";
import { NotificationBell } from "@/components/mcm/notification-parts";
import { ConfirmDialog, LoadingSkeleton, MCMAvatar, ProtoNote, SettingRow } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useRequireAuth } from "@/lib/api/guard";
import { canManage, ROLE_LABEL, type BusinessMemberRow } from "@/lib/api/business";
import { useMyBusiness } from "@/lib/api/queries";
import { uploadChatMedia } from "@/lib/api/storage";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import {
  getSettings,
  listDevices,
  notificationsOf,
  privacyOf,
  removeDevice,
  securityOf,
  updateSettings,
  type DeviceRow,
  type UserSettingsRow,
} from "@/lib/api/settings";

export const Route = createFileRoute("/profile/")({
  head: () => ({
    meta: [
      { title: "Profil & Pengaturan — MCM" },
      { name: "description", content: "Kelola profil, PIN MCM, bisnis, privasi, keamanan, notifikasi, dan tema aplikasi Anda." },
      { property: "og:title", content: "Profil & Pengaturan — MCM" },
      { property: "og:description", content: "Atur profil, bisnis, privasi, dan tampilan MCM." },
    ],
  }),
  component: ProfilePage,
});

type MemberWithProfile = BusinessMemberRow & { profile: { display_name: string; pin: string } | null };

function ProfilePage() {
  const { userId, profile, loading } = useRequireAuth();
  const { refresh, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const avatarUrl = useSignedUrl("avatars", profile?.avatar_url ?? null);

  const [name, setName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [settings, setSettings] = useState<UserSettingsRow | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const { data: myBiz, isLoading: bizLoading, isError: bizError, refetch: refetchBiz } = useMyBusiness(userId);
  const [bizForm, setBizForm] = useState({
    name: "", category: "", description: "", address: "", hours: "", contact: "", greeting: "", away_message: "", is_public: true,
  });
  const [savingBiz, setSavingBiz] = useState(false);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);

  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
      setBio(profile.bio);
    }
  }, [profile]);

  useEffect(() => {
    if (myBiz) {
      const b = myBiz.business;
      setBizForm({
        name: b.name, category: b.category, description: b.description, address: b.address, hours: b.hours,
        contact: b.contact, greeting: b.greeting, away_message: b.away_message, is_public: b.is_public,
      });
      void supabase
        .from("business_members")
        .select("*")
        .eq("business_id", b.id)
        .then(async ({ data }) => {
          const rows = data ?? [];
          const ids = rows.map((r) => r.user_id);
          const { data: profiles } = await supabase.from("profiles").select("id, display_name, pin").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
          const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
          setMembers(rows.map((r) => ({ ...r, profile: pmap.get(r.user_id) ?? null })));
        });
    }
  }, [myBiz]);

  const loadSettings = () => {
    if (!userId) return;
    setSettingsError(null);
    getSettings(userId)
      .then(setSettings)
      .catch((err) => setSettingsError(err instanceof Error ? err.message : "Gagal memuat pengaturan"));
  };
  const loadDevices = () => {
    if (!userId) return;
    setDevicesError(null);
    listDevices(userId)
      .then(setDevices)
      .catch((err) => setDevicesError(err instanceof Error ? err.message : "Gagal memuat perangkat"));
  };

  useEffect(() => {
    loadSettings();
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveProfile = async () => {
    if (!userId) return;
    if (name.trim().length < 3) {
      toast.error("Nama minimal 3 karakter");
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase.from("profiles").update({ display_name: name.trim(), bio: bio.trim() }).eq("id", userId);
      if (error) throw new Error(error.message);
      await refresh();
      toast.success("Profil diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan profil");
    } finally {
      setSavingProfile(false);
    }
  };

  const onAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    setUploading(true);
    try {
      const up = await uploadChatMedia(`avatars/${userId}`, file, file.name);
      const { error } = await supabase.from("profiles").update({ avatar_url: up.path }).eq("id", userId);
      if (error) throw new Error(error.message);
      await refresh();
      toast.success("Foto profil diperbarui");
    } catch {
      toast.error("Gagal mengunggah foto profil");
    } finally {
      setUploading(false);
    }
  };

  const patchSettings = async (patch: Parameters<typeof updateSettings>[1]) => {
    if (!userId) return;
    try {
      const next = await updateSettings(userId, patch);
      setSettings(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan pengaturan");
    }
  };

  const saveBusiness = async () => {
    if (!myBiz) return;
    setSavingBiz(true);
    try {
      const { error } = await supabase.from("businesses").update(bizForm).eq("id", myBiz.business.id);
      if (error) throw new Error(error.message);
      void refetchBiz();
      toast.success("Data bisnis diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan data bisnis");
    } finally {
      setSavingBiz(false);
    }
  };

  const changeRole = async (memberId: string, role: BusinessMemberRow["role"]) => {
    try {
      const { error } = await supabase.from("business_members").update({ role }).eq("id", memberId);
      if (error) throw new Error(error.message);
      setMembers((p) => p.map((m) => (m.id === memberId ? { ...m, role } : m)));
      toast.success("Peran diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memperbarui peran");
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      const { error } = await supabase.from("business_members").delete().eq("id", memberId);
      if (error) throw new Error(error.message);
      setMembers((p) => p.filter((m) => m.id !== memberId));
      toast.success("Anggota dihapus dari tim");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus anggota");
    }
  };

  if (loading || !profile) {
    return (
      <AppShell header={<MobileHeader title="Profil" />}>
        <LoadingSkeleton rows={6} />
      </AppShell>
    );
  }

  const notif = notificationsOf(settings);
  const priv = privacyOf(settings);
  const sec = securityOf(settings);
  const role = myBiz?.role;

  return (
    <AppShell
      header={
        <MobileHeader
          title="Profil"
          subtitle={`PIN ${profile.pin}`}
          actions={<NotificationBell userId={userId} />}
        />
      }
    >
      <div className="space-y-4 px-4 py-4 pb-24">
        <div className="card-soft flex items-center gap-3 p-4">
          <div className="relative">
            <MCMAvatar
              initials={profile.display_name.slice(0, 2).toUpperCase()}
              color={profile.avatar_color}
              size="lg"
            />
            {avatarUrl && (
              <img src={avatarUrl} alt={profile.display_name} className="absolute inset-0 size-16 rounded-full object-cover" />
            )}
            <label className="absolute -right-1 -bottom-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Camera className="size-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void onAvatarChange(e)} disabled={uploading} />
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{profile.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">{profile.bio || "Belum ada bio"}</p>
          </div>
        </div>

        <PinCard pin={profile.pin} name={profile.display_name} subtitle={profile.bio} />

        <div className="card-soft space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="nm">Nama</Label>
            <Input id="nm" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" maxLength={140} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <Button className="w-full rounded-xl" disabled={savingProfile} onClick={() => void saveProfile()}>
            {savingProfile ? "Menyimpan…" : "Simpan perubahan"}
          </Button>
        </div>

        <div className="card-soft space-y-3 p-4">
          <p className="text-sm font-semibold">Bisnis</p>
          {bizLoading ? (
            <LoadingSkeleton rows={2} avatar={false} />
          ) : bizError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Gagal memuat data bisnis.</p>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={() => void refetchBiz()}>
                Coba lagi
              </Button>
            </div>
          ) : !myBiz ? (
            <p className="text-xs text-muted-foreground">Anda belum tergabung dalam bisnis apa pun.</p>
          ) : (
            <div className="space-y-3">
              {canManage(role) ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Nama bisnis</Label>
                      <Input value={bizForm.name} maxLength={60} onChange={(e) => setBizForm((p) => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Kategori</Label>
                      <Input value={bizForm.category} maxLength={40} onChange={(e) => setBizForm((p) => ({ ...p, category: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Deskripsi</Label>
                    <Textarea value={bizForm.description} maxLength={280} rows={2} onChange={(e) => setBizForm((p) => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Alamat</Label>
                    <Input value={bizForm.address} maxLength={140} onChange={(e) => setBizForm((p) => ({ ...p, address: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Jam operasional</Label>
                      <Input value={bizForm.hours} maxLength={80} onChange={(e) => setBizForm((p) => ({ ...p, hours: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Kontak</Label>
                      <Input value={bizForm.contact} maxLength={80} onChange={(e) => setBizForm((p) => ({ ...p, contact: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pesan sapaan</Label>
                    <Textarea value={bizForm.greeting} maxLength={200} rows={2} onChange={(e) => setBizForm((p) => ({ ...p, greeting: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pesan tidak aktif</Label>
                    <Textarea value={bizForm.away_message} maxLength={200} rows={2} onChange={(e) => setBizForm((p) => ({ ...p, away_message: e.target.value }))} />
                  </div>
                  <SettingRow
                    label="Profil bisnis publik"
                    description="Terlihat oleh pengguna lain lewat pencarian"
                    right={<Switch checked={bizForm.is_public} onCheckedChange={(v) => setBizForm((p) => ({ ...p, is_public: v }))} />}
                  />
                  <Button className="w-full rounded-xl" disabled={savingBiz} onClick={() => void saveBusiness()}>
                    {savingBiz ? "Menyimpan…" : "Simpan data bisnis"}
                  </Button>
                </>
              ) : (
                <p className="text-sm font-medium">{myBiz.business.name}</p>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Tim</p>
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m.profile?.display_name ?? "Pengguna"}</p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</p>
                    </div>
                    {canManage(role) && m.role !== "owner" && (
                      <div className="flex shrink-0 items-center gap-1">
                        <select
                          className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                          value={m.role}
                          onChange={(e) => void changeRole(m.id, e.target.value as BusinessMemberRow["role"])}
                        >
                          {(["admin", "agent", "cashier", "viewer"] as const).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" variant="ghost" className="text-xs text-destructive" onClick={() => void removeMember(m.id)}>
                          Hapus
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card-soft divide-y divide-border">
          {settingsError ? (
            <div className="flex items-center justify-between gap-2 p-4">
              <p className="text-xs text-muted-foreground">{settingsError}</p>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={loadSettings}>
                Coba lagi
              </Button>
            </div>
          ) : (
            <>
              <SettingRow
                icon={Moon}
                label="Mode gelap"
                description="Sesuaikan tampilan dengan pencahayaan sekitar"
                right={
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={(v) => {
                      setTheme(v ? "dark" : "light");
                      void patchSettings({ theme: v ? "dark" : "light" });
                    }}
                  />
                }
              />
              <button
                type="button"
                onClick={() => void navigate({ to: "/settings/notifications" })}
                className="flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition hover:bg-muted/60"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Bell className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Izin & notifikasi</span>
                  <span className="block text-xs text-muted-foreground">
                    Channel push, pratinjau pesan, izin kamera/lokasi, dan perangkat terdaftar
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <SettingRow
                icon={Shield}
                label="Kunci aplikasi"
                description="Minta PIN perangkat saat membuka MCM"
                right={<Switch checked={sec.appLock} onCheckedChange={(v) => void patchSettings({ security: { appLock: v } })} />}
              />
              <SettingRow
                icon={KeyRound}
                label="Verifikasi dua langkah"
                description="Minta kode tambahan saat masuk di perangkat baru"
                right={<Switch checked={sec.twoFactor} onCheckedChange={(v) => void patchSettings({ security: { twoFactor: v } })} />}
              />
              <SettingRow
                icon={Palette}
                label="Status online"
                description="Tampilkan saat Anda sedang aktif"
                right={<Switch checked={priv.online} onCheckedChange={(v) => void patchSettings({ privacy: { online: v } })} />}
              />
              <SettingRow
                icon={Eye}
                label="Centang dibaca"
                description="Bagikan status baca ke lawan bicara"
                right={<Switch checked={priv.readReceipts} onCheckedChange={(v) => void patchSettings({ privacy: { readReceipts: v } })} />}
              />
            </>
          )}
        </div>

        <div className="card-soft space-y-3 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Monitor className="size-4" /> Perangkat aktif
          </p>
          {devicesError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{devicesError}</p>
              <Button size="sm" variant="outline" className="rounded-lg" onClick={loadDevices}>
                Coba lagi
              </Button>
            </div>
          ) : devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">Belum ada perangkat tercatat.</p>
          ) : (
            devices.map((dv) => (
              <div key={dv.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{dv.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {dv.platform} • aktif {new Date(dv.last_active_at).toLocaleString("id-ID")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg text-xs"
                  onClick={() =>
                    void removeDevice(dv.id)
                      .then(() => {
                        setDevices((p) => p.filter((x) => x.id !== dv.id));
                        toast.success("Perangkat dikeluarkan");
                      })
                      .catch((err) => toast.error(err instanceof Error ? err.message : "Gagal mengeluarkan perangkat"))
                  }
                >
                  Keluarkan perangkat
                </Button>
              </div>
            ))
          )}
        </div>

        <Button variant="outline" className="w-full justify-start rounded-xl" onClick={() => void navigate({ to: "/contacts" })}>
          <Users className="size-4" /> Kelola kontak
        </Button>
        <div className="grid grid-cols-1 gap-2">
          <a href="/privacy" className="card-soft block px-4 py-3 text-sm font-medium">Kebijakan privasi</a>
          <a href="/terms" className="card-soft block px-4 py-3 text-sm font-medium">Syarat & ketentuan</a>
          <a href="/support" className="card-soft block px-4 py-3 text-sm font-medium">Pusat bantuan</a>
          <a href="/delete-account" className="card-soft block px-4 py-3 text-sm font-medium text-destructive">Hapus akun</a>
        </div>

        <Button variant="outline" className="w-full rounded-xl text-destructive" onClick={() => setLogoutOpen(true)}>
          <LogOut className="size-4" /> Keluar
        </Button>

        <ProtoNote>Notifikasi push Android belum dikonfigurasi. Preferensi tersimpan tetapi belum mengirim push nyata.</ProtoNote>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Keluar dari akun?"
        description="Anda perlu masuk kembali untuk mengakses MCM."
        confirmLabel="Keluar"
        destructive
        onConfirm={() => {
          void signOut().then(() => navigate({ to: "/login" }));
        }}
      />
    </AppShell>
  );
}
