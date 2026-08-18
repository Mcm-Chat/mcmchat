import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Bell,
  Camera,
  CircleUserRound,
  Crown,
  Download,
  Eye,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Phone,
  Shield,
  Users,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { PinCard, QRCard } from "@/components/mcm/pin-card";
import { NotificationBell } from "@/components/mcm/notification-parts";
import { NotificationPermissionRow } from "@/components/mcm/notification-permission-row";
import {
  ConfirmDialog,
  LoadingSkeleton,
  MCMAvatar,
  ProtoNote,
  SettingRow,
} from "@/components/mcm/primitives";
import { FieldError } from "@/components/mcm/primitives";
import { fieldErrors, profileSchema } from "@/lib/validation/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useReduceMotion } from "@/lib/a11y/reduce-motion";
import { useRequireAuth } from "@/lib/api/guard";
import {
  canManage,
  MEMBER_SAFE_COLUMNS,
  ROLE_LABEL,
  type BusinessMemberRow,
} from "@/lib/api/business";
import { useMyBusiness } from "@/lib/api/queries";
import { AvatarEditor } from "@/components/mcm/lazy-heavy";
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
  const {
    preference: motionPreference,
    reduced: motionReduced,
    setPreference: setMotion,
  } = useReduceMotion();
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
  const [profileTouched, setProfileTouched] = useState<{ name?: boolean; bio?: boolean }>({});
  const profileErrors = fieldErrors(profileSchema, { name, bio });
  const profileValid = Object.keys(profileErrors).length === 0;
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
          const { fetchProfileCards } = await import("@/lib/api/profiles");
          const [cards, pins] = await Promise.all([fetchProfileCards(ids), pinsFor(ids)]);
          const pmap = new Map(
            [...cards.values()].map((p) => [
              p.id,
              { id: p.id, display_name: p.display_name, pin: pins.get(p.id) ?? "" },
            ]),
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
    listDevices()
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
    setProfileTouched({ name: true, bio: true });
    if (!profileValid) return;
    setSavingProfile(true);
    try {
      const { updateMyProfile } = await import("@/lib/api/profiles");
      await updateMyProfile(name.trim(), bio.trim());
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
    const loadingId = toast.loading("Memasang foto profil…");
    try {
      await commitAvatar(userId, blob);
      await refresh();
      setDraftFile(null);
      toast.success("Foto profil dipasang", { id: loadingId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memasang foto profil";
      toast.error(message, { id: loadingId });
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
      <div className="space-y-3 px-4 py-4 pb-[max(6rem,env(safe-area-inset-bottom)+6rem)]">
        <div className="card-soft flex items-center gap-3 p-4">
          <div className="relative shrink-0 p-1.5">
            <UserAvatar
              userId={profile.id}
              path={profile.avatar_url}
              version={(profile as { avatar_version?: number }).avatar_version ?? 0}
              name={profile.display_name}
              color={profile.avatar_color}
              size="lg"
            />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    tabIndex={0}
                    role="button"
                    aria-label="Ubah foto profil"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.currentTarget.querySelector("input")?.click();
                      }
                    }}
                    className="absolute right-0 bottom-0 cursor-pointer rounded-full p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm">
                      <Camera className="size-4" aria-hidden="true" />
                      <span className="sr-only">Ubah foto profil</span>
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      aria-label="Unggah foto profil"
                      onChange={onAvatarPick}
                      disabled={uploading}
                    />
                  </label>
                </TooltipTrigger>
                <TooltipContent side="bottom">Ubah foto profil</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{profile.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {profile.bio || "Belum ada bio"}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
              <label className="inline-flex min-h-11 cursor-pointer items-center text-primary">
                Kamera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  aria-label="Ambil foto profil dengan kamera"
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
                  aria-label="Pilih foto profil dari galeri"
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

        <QRCard pin={profile.pin} label={profile.display_name} />

        <div className="card-soft space-y-2 p-4">
          <div className="space-y-1">
            <Label htmlFor="nm">Nama</Label>
            <Input
              id="nm"
              maxLength={60}
              value={name}
              aria-invalid={!!(profileTouched.name && profileErrors["name"])}
              aria-describedby={
                profileTouched.name && profileErrors["name"] ? "nm-error" : undefined
              }
              onBlur={() => setProfileTouched((p) => ({ ...p, name: true }))}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldError
              id="nm-error"
              message={profileTouched.name ? profileErrors["name"] : undefined}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              maxLength={140}
              value={bio}
              onBlur={() => setProfileTouched((p) => ({ ...p, bio: true }))}
              onChange={(e) => setBio(e.target.value)}
            />
            <FieldError message={profileTouched.bio ? profileErrors["bio"] : undefined} />
          </div>
          <Button
            className="w-full rounded-xl"
            disabled={savingProfile || !profileValid}
            onClick={() => void saveProfile()}
          >
            {savingProfile ? "Menyimpan…" : "Simpan perubahan"}
          </Button>
        </div>

        <div className="card-soft p-4">
          <p className="text-sm font-semibold">Bisnis</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Katalog, tugas penyiapan, dan pengaturan tim kini ada di tab Bisnis.
          </p>
          <Button
            variant="outline"
            className="mt-3 h-11 w-full rounded-xl"
            onClick={() => void navigate({ to: "/business/kelola" })}
          >
            Buka Kelola Bisnis
          </Button>
        </div>

        <div className="card-soft divide-y divide-border">
          <SettingRow
            icon={CircleUserRound}
            label="Status"
            description="Lihat dan buat status harian"
            right={<ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            onClick={() => void navigate({ to: "/status" })}
          />
          <SettingRow
            icon={Crown}
            label="Premium"
            description="Fitur lanjutan untuk bisnis kamu"
            right={<ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            onClick={() => void navigate({ to: "/premium" })}
          />
          <SettingRow
            icon={Download}
            label="Download aplikasi"
            description="Pasang MCM di perangkat kamu"
            right={<ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            onClick={() => void navigate({ to: "/download" })}
          />
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
              <SettingRow
                icon={Sparkles}
                label="Kurangi animasi"
                description={
                  motionPreference === "auto"
                    ? `Mengikuti setelan perangkat (saat ini ${motionReduced ? "aktif" : "nonaktif"})`
                    : "Mematikan animasi non-kritis seperti transisi dan efek gelembung pesan"
                }
                right={
                  <Switch
                    aria-label="Kurangi animasi"
                    checked={motionReduced}
                    onCheckedChange={(v) => {
                      setMotion(v ? "on" : "off");
                      toast.success(v ? "Animasi dikurangi" : "Animasi diaktifkan");
                    }}
                  />
                }
              />

              <NotificationPermissionRow userId={userId} />
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
                onClick={() => void navigate({ to: "/settings/calls" })}
                className="flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition hover:bg-muted/60"
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Stethoscope className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Diagnostik panggilan</span>
                  <span className="block text-xs text-muted-foreground">
                    Cek penyedia, HTTPS, izin mikrofon/kamera, dan tes perangkat
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
