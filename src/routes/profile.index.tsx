import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Bell,
  Camera,
  Eye,
  Globe,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Phone,
  Shield,
  Users,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { PinCard } from "@/components/mcm/pin-card";
import { NotificationBell } from "@/components/mcm/notification-parts";
import {
  ConfirmDialog,
  LoadingSkeleton,
  MCMAvatar,
  ProtoNote,
  SettingRow,
} from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useRequireAuth } from "@/lib/api/guard";
import {
  canManage,
  MEMBER_SAFE_COLUMNS,
  ROLE_LABEL,
  type BusinessMemberRow,
} from "@/lib/api/business";
import { useMyBusiness } from "@/lib/api/queries";
import { AvatarEditor } from "@/components/mcm/avatar-editor";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { AvatarAudienceDialog } from "@/components/mcm/avatar-audience-dialog";
import {
  AVATAR_PRIVACY_LABEL,
  commitAvatar,
  listAvatarAudience,
  removeAvatar,
  setAvatarPrivacy,
  type AvatarPrivacy,
} from "@/lib/api/avatar";
import { audienceModeFor, audienceSummary, needsAudience } from "@/lib/media/avatar-audience";
import { readScreenSecurity, type ScreenSecurityStatus } from "@/lib/security/screen-privacy";
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
      {
        name: "description",
        content:
          "Kelola profil, PIN MCM, bisnis, privasi, keamanan, notifikasi, dan tema aplikasi Anda.",
      },
      { property: "og:title", content: "Profil & Pengaturan — MCM" },
      { property: "og:description", content: "Atur profil, bisnis, privasi, dan tampilan MCM." },
    ],
  }),
  component: ProfilePage,
});

type MemberWithProfile = Omit<BusinessMemberRow, "staff_pin"> & {
  profile: { display_name: string; pin: string } | null;
};

function ProfilePage() {
  const { userId, profile, loading } = useRequireAuth();
  const { refresh, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [avatarPrivacy, setAvatarPrivacyState] = useState<AvatarPrivacy>("contacts");
  const [removeAvatarOpen, setRemoveAvatarOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audienceCount, setAudienceCount] = useState(0);
  // Mode berbasis daftar hanya aktif setelah audiens disimpan (transaksional).
  const [pendingAvatarPrivacy, setPendingAvatarPrivacy] = useState<AvatarPrivacy | null>(null);

  const [name, setName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [settings, setSettings] = useState<UserSettingsRow | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [logoutOpen, setLogoutOpen] = useState(false);

  const {
    data: myBiz,
    isLoading: bizLoading,
    isError: bizError,
    refetch: refetchBiz,
  } = useMyBusiness(userId);
  const [bizForm, setBizForm] = useState({
    name: "",
    category: "",
    description: "",
    address: "",
    hours: "",
    contact: "",
    greeting: "",
    away_message: "",
    is_public: true,
  });
  const [savingBiz, setSavingBiz] = useState(false);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  // Status read-only: berasal dari kapabilitas wadah native, bukan toggle demo.
  // Wajib berada di atas setiap conditional return agar urutan hook stabil.
  const [screenSecurity, setScreenSecurity] = useState<ScreenSecurityStatus>(() =>
    readScreenSecurity(),
  );

  useEffect(() => {
    setScreenSecurity(readScreenSecurity(window as never));
  }, []);

  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
      setBio(profile.bio);
      setAvatarPrivacyState(
        ((profile as { avatar_privacy?: string }).avatar_privacy as AvatarPrivacy) ?? "contacts",
      );
    }
  }, [profile]);

  // Jumlah audiens aktif ditampilkan di ringkasan opsi privasi.
  useEffect(() => {
    const mode = audienceModeFor(avatarPrivacy);
    if (!userId || !mode) {
      setAudienceCount(0);
      return;
    }
    let active = true;
    void listAvatarAudience(userId, mode)
      .then((rows) => {
        if (active) setAudienceCount(rows.length);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId, avatarPrivacy]);

  useEffect(() => {
    if (myBiz) {
      const b = myBiz.business;
      setBizForm({
        name: b.name,
        category: b.category,
        description: b.description,
        address: b.address,
        hours: b.hours,
        contact: b.contact,
        greeting: b.greeting,
        away_message: b.away_message,
        is_public: b.is_public,
      });
      void supabase
        .from("business_members")
        .select(MEMBER_SAFE_COLUMNS)
        .eq("business_id", b.id)
        .then(async ({ data }) => {
          const rows = data ?? [];
          const ids = rows.map((r) => r.user_id);
          const { pinsFor } = await import("@/lib/api/pins");
          const [{ data: profiles }, pins] = await Promise.all([
            supabase
              .from("profiles")
              .select("id, display_name")
              .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
            pinsFor(ids),
          ]);
          const pmap = new Map(
            (profiles ?? []).map((p) => [p.id, { ...p, pin: pins.get(p.id) ?? "" }]),
          );
          setMembers(rows.map((r) => ({ ...r, profile: pmap.get(r.user_id) ?? null })));
        });
    }
  }, [myBiz]);

  const loadSettings = () => {
    if (!userId) return;
    setSettingsError(null);
    getSettings(userId)
      .then(setSettings)
      .catch((err) =>
        setSettingsError(err instanceof Error ? err.message : "Gagal memuat pengaturan"),
      );
  };
  const loadDevices = () => {
    if (!userId) return;
    setDevicesError(null);
    listDevices(userId)
      .then(setDevices)
      .catch((err) =>
        setDevicesError(err instanceof Error ? err.message : "Gagal memuat perangkat"),
      );
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
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name.trim(), bio: bio.trim() })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      await refresh();
      toast.success("Profil diperbarui");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan profil");
    } finally {
      setSavingProfile(false);
    }
  };

  /**
   * Foto yang baru dipilih hanya masuk ke draft editor. Tidak ada unggahan
   * maupun perubahan `profiles.avatar_*` sebelum tombol “Pasang foto profil”.
   */
  const onAvatarPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDraftFile(file);
  };

  const applyAvatar = async (blob: Blob) => {
    if (!userId) return;
    setUploading(true);
    try {
      await commitAvatar(userId, blob);
      await refresh();
      setDraftFile(null);
      toast.success("Foto profil dipasang");
    } finally {
      setUploading(false);
    }
  };

  const deleteAvatar = async () => {
    if (!userId) return;
    try {
      await removeAvatar(userId);
      await refresh();
      toast.success("Foto profil dihapus");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus foto profil");
    }
  };

  const changeAvatarPrivacy = async (value: AvatarPrivacy) => {
    if (!userId) return;
    // contacts_except / only_share: jangan sentuh DB sebelum audiens disimpan.
    if (needsAudience(value)) {
      setPendingAvatarPrivacy(value);
      setAudienceOpen(true);
      return;
    }
    const prev = avatarPrivacy;
    setAvatarPrivacyState(value);
    try {
      await setAvatarPrivacy(userId, value);
      await refresh();
    } catch (err) {
      setAvatarPrivacyState(prev);
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan privasi foto profil");
    }
  };

  // Dipanggil hanya setelah RPC atomik sukses.
  const onAudienceSaved = async (privacy: AvatarPrivacy, count: number) => {
    setAvatarPrivacyState(privacy);
    setAudienceCount(count);
    setPendingAvatarPrivacy(null);
    await refresh();
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
      const { error } = await supabase
        .from("businesses")
        .update(bizForm)
        .eq("id", myBiz.business.id);
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
            <UserAvatar
              userId={profile.id}
              path={profile.avatar_url}
              version={(profile as { avatar_version?: number }).avatar_version ?? 0}
              name={profile.display_name}
              color={profile.avatar_color}
              size="lg"
            />
            <label className="absolute -right-1 -bottom-1 flex size-11 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
              <Camera className="size-5" />
              <span className="sr-only">Ubah foto profil</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onAvatarPick}
                disabled={uploading}
              />
            </label>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{profile.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {profile.bio || "Belum ada bio"}
            </p>
            <div className="mt-1 flex gap-3 text-[11px]">
              <label className="inline-flex min-h-11 cursor-pointer items-center text-primary">
                Kamera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onAvatarPick}
                  disabled={uploading}
                />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center text-primary">
                Galeri
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={onAvatarPick}
                  disabled={uploading}
                />
              </label>
              {profile.avatar_url && (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center text-destructive"
                  onClick={() => setRemoveAvatarOpen(true)}
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card-soft space-y-2 p-4">
          <p className="text-sm font-semibold">Siapa yang dapat melihat foto profil</p>
          <div className="grid gap-2">
            {(Object.keys(AVATAR_PRIVACY_LABEL) as AvatarPrivacy[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => void changeAvatarPrivacy(key)}
                className={`flex min-h-11 items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                  avatarPrivacy === key ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span>{AVATAR_PRIVACY_LABEL[key]}</span>
                {avatarPrivacy === key && <span className="text-xs text-primary">Aktif</span>}
              </button>
            ))}
          </div>
          {needsAudience(avatarPrivacy) && (
            <button
              type="button"
              onClick={() => {
                setPendingAvatarPrivacy(avatarPrivacy);
                setAudienceOpen(true);
              }}
              className="flex min-h-11 w-full items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">
                {audienceSummary(avatarPrivacy, audienceCount)}
              </span>
              <span className="text-primary">Pilih kontak</span>
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">
            Pengguna yang Anda blokir tidak pernah melihat foto profil, apa pun pilihannya.
          </p>
        </div>

        <PinCard pin={profile.pin} name={profile.display_name} subtitle={profile.bio} />

        <div className="card-soft space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="nm">Nama</Label>
            <Input id="nm" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              maxLength={140}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>
          <Button
            className="w-full rounded-xl"
            disabled={savingProfile}
            onClick={() => void saveProfile()}
          >
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
              <Button
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => void refetchBiz()}
              >
                Coba lagi
              </Button>
            </div>
          ) : !myBiz ? (
            <p className="text-xs text-muted-foreground">
              Anda belum tergabung dalam bisnis apa pun.
            </p>
          ) : (
            <div className="space-y-3">
              {canManage(role) ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Nama bisnis</Label>
                      <Input
                        value={bizForm.name}
                        maxLength={60}
                        onChange={(e) => setBizForm((p) => ({ ...p, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Kategori</Label>
                      <Input
                        value={bizForm.category}
                        maxLength={40}
                        onChange={(e) => setBizForm((p) => ({ ...p, category: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Deskripsi</Label>
                    <Textarea
                      value={bizForm.description}
                      maxLength={280}
                      rows={2}
                      onChange={(e) => setBizForm((p) => ({ ...p, description: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Alamat</Label>
                    <Input
                      value={bizForm.address}
                      maxLength={140}
                      onChange={(e) => setBizForm((p) => ({ ...p, address: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Jam operasional</Label>
                      <Input
                        value={bizForm.hours}
                        maxLength={80}
                        onChange={(e) => setBizForm((p) => ({ ...p, hours: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Kontak</Label>
                      <Input
                        value={bizForm.contact}
                        maxLength={80}
                        onChange={(e) => setBizForm((p) => ({ ...p, contact: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pesan sapaan</Label>
                    <Textarea
                      value={bizForm.greeting}
                      maxLength={200}
                      rows={2}
                      onChange={(e) => setBizForm((p) => ({ ...p, greeting: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Pesan tidak aktif</Label>
                    <Textarea
                      value={bizForm.away_message}
                      maxLength={200}
                      rows={2}
                      onChange={(e) => setBizForm((p) => ({ ...p, away_message: e.target.value }))}
                    />
                  </div>
                  <SettingRow
                    label="Profil bisnis publik"
                    description="Terlihat oleh pengguna lain lewat pencarian"
                    right={
                      <Switch
                        checked={bizForm.is_public}
                        onCheckedChange={(v) => setBizForm((p) => ({ ...p, is_public: v }))}
                      />
                    }
                  />
                  <Button
                    className="w-full rounded-xl"
                    disabled={savingBiz}
                    onClick={() => void saveBusiness()}
                  >
                    {savingBiz ? "Menyimpan…" : "Simpan data bisnis"}
                  </Button>
                </>
              ) : (
                <p className="text-sm font-medium">{myBiz.business.name}</p>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">Tim</p>
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.profile?.display_name ?? "Pengguna"}
                      </p>
                      <p className="text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</p>
                    </div>
                    {canManage(role) && m.role !== "owner" && (
                      <div className="flex shrink-0 items-center gap-1">
                        <select
                          className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                          value={m.role}
                          onChange={(e) =>
                            void changeRole(m.id, e.target.value as BusinessMemberRow["role"])
                          }
                        >
                          {(["admin", "agent", "cashier", "viewer"] as const).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs text-destructive"
                          onClick={() => void removeMember(m.id)}
                        >
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
              <button
                type="button"
                onClick={() => void navigate({ to: "/settings/voice" })}
                className="flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition hover:bg-muted/60"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Panggilan • Efek Suara Premium</span>
                  <span className="block text-xs text-muted-foreground">
                    Preset Voice Privacy default dan tes mikrofon sebelum menelepon
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={() => void navigate({ to: "/settings/domain" })}
                className="flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition hover:bg-muted/60"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Globe className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Verifikasi domain</span>
                  <span className="block text-xs text-muted-foreground">
                    Status TXT _lovable, record A www, dan panduan langkah demi langkah
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <SettingRow
                icon={Shield}
                label="Kunci aplikasi"
                description="Minta PIN perangkat saat membuka MCM"
                right={
                  <Switch
                    checked={sec.appLock}
                    onCheckedChange={(v) => void patchSettings({ security: { appLock: v } })}
                  />
                }
              />
              <SettingRow
                icon={Shield}
                label="Perlindungan layar"
                description={screenSecurity.detail}
                right={
                  <span className="max-w-[9rem] text-right text-[10px] leading-tight font-medium text-muted-foreground">
                    {screenSecurity.flagSecure ? "APK Android" : "Web/PWA"}
                  </span>
                }
              />
              <p className="px-1 text-xs text-muted-foreground">{screenSecurity.label}</p>
              <SettingRow
                icon={KeyRound}
                label="Verifikasi dua langkah"
                description="Minta kode tambahan saat masuk di perangkat baru"
                right={
                  <Switch
                    checked={sec.twoFactor}
                    onCheckedChange={(v) => void patchSettings({ security: { twoFactor: v } })}
                  />
                }
              />
              <SettingRow
                icon={Palette}
                label="Status online"
                description="Tampilkan saat Anda sedang aktif"
                right={
                  <Switch
                    checked={priv.online}
                    onCheckedChange={(v) => void patchSettings({ privacy: { online: v } })}
                  />
                }
              />
              <SettingRow
                icon={Eye}
                label="Centang dibaca"
                description="Bagikan status baca ke lawan bicara"
                right={
                  <Switch
                    checked={priv.readReceipts}
                    onCheckedChange={(v) => void patchSettings({ privacy: { readReceipts: v } })}
                  />
                }
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
              <div
                key={dv.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3"
              >
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
                      .catch((err) =>
                        toast.error(
                          err instanceof Error ? err.message : "Gagal mengeluarkan perangkat",
                        ),
                      )
                  }
                >
                  Keluarkan perangkat
                </Button>
              </div>
            ))
          )}
        </div>

        <Button
          variant="outline"
          className="w-full justify-start rounded-xl"
          onClick={() => void navigate({ to: "/contacts" })}
        >
          <Users className="size-4" /> Kelola kontak
        </Button>
        <div className="grid grid-cols-1 gap-2">
          <a href="/privacy" className="card-soft block px-4 py-3 text-sm font-medium">
            Kebijakan privasi
          </a>
          <a href="/terms" className="card-soft block px-4 py-3 text-sm font-medium">
            Syarat & ketentuan
          </a>
          <a href="/support" className="card-soft block px-4 py-3 text-sm font-medium">
            Pusat bantuan
          </a>
          <a
            href="/delete-account"
            className="card-soft block px-4 py-3 text-sm font-medium text-destructive"
          >
            Hapus akun
          </a>
        </div>

        <Button
          variant="outline"
          className="w-full rounded-xl text-destructive"
          onClick={() => setLogoutOpen(true)}
        >
          <LogOut className="size-4" /> Keluar
        </Button>

        <ProtoNote>
          Notifikasi push Android belum dikonfigurasi. Preferensi tersimpan tetapi belum mengirim
          push nyata.
        </ProtoNote>
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

      <ConfirmDialog
        open={removeAvatarOpen}
        onOpenChange={setRemoveAvatarOpen}
        title="Hapus foto profil?"
        description="Kontak akan kembali melihat inisial nama Anda."
        confirmLabel="Hapus"
        destructive
        onConfirm={() => void deleteAvatar()}
      />

      {draftFile && (
        <AvatarEditor file={draftFile} onCancel={() => setDraftFile(null)} onApply={applyAvatar} />
      )}

      {userId && (
        <AvatarAudienceDialog
          open={audienceOpen}
          userId={userId}
          privacy={pendingAvatarPrivacy ?? avatarPrivacy}
          onOpenChange={(o) => {
            setAudienceOpen(o);
            // Batal/back: mode aktif lama dipertahankan, DB tidak tersentuh.
            if (!o) setPendingAvatarPrivacy(null);
          }}
          onSaved={onAudienceSaved}
        />
      )}
    </AppShell>
  );
}
