import { useEffect, useState } from "react";
import { Eye, KeyRound, Moon, Palette, Shield, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SettingRow } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { privacyOf, type SettingsPatch } from "@/lib/api/settings";
import { useUserSettings } from "@/lib/settings/use-settings";
import { useTheme } from "@/lib/theme";
import { getActiveUserId } from "@/lib/session-scope";
import { useReduceMotion } from "@/lib/a11y/reduce-motion";
import { readScreenSecurity } from "@/lib/security/screen-privacy";

/** Account preferences and local display controls have different storage scopes. */
export function AccountPreferenceControls({ userId }: { userId: string | undefined }) {
  const { settings, loading, error, saving, refresh, patch } = useUserSettings(userId);
  const { theme, setTheme } = useTheme();
  const { preference, reduced, setPreference } = useReduceMotion();
  const [screenSecurity, setScreenSecurity] = useState(() => readScreenSecurity());
  useEffect(() => {
    const refreshStatus = () => setScreenSecurity(readScreenSecurity(window as never));
    refreshStatus();
    window.addEventListener("focus", refreshStatus);
    return () => window.removeEventListener("focus", refreshStatus);
  }, []);
  const disabled = loading || saving || !settings || Boolean(error);
  const privacy = privacyOf(settings);

  const save = async (value: SettingsPatch) => {
    try {
      const next = await patch(value);
      // Applying after acknowledgement avoids a local-only theme on save failure.
      if (value.theme && getActiveUserId() === userId) {
        setTheme(next.theme === "light" ? "light" : "dark");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan pengaturan");
    }
  };

  return (
    <>
      <div className="space-y-1 px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">Tampilan & privasi</h2>
        <p className="text-xs text-muted-foreground">
          Tema dan centang dibaca tersimpan di akun. Animasi mengikuti perangkat ini.
        </p>
        {loading && !settings && (
          <p role="status" className="text-xs">
            Memuat pengaturan…
          </p>
        )}
        {saving && (
          <p role="status" className="text-xs">
            Menyimpan pengaturan…
          </p>
        )}
        {error && (
          <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 p-3">
            <p className="text-xs text-destructive">{error}</p>
            <Button variant="outline" className="min-h-11" onClick={() => void refresh()}>
              Muat ulang pengaturan
            </Button>
          </div>
        )}
      </div>
      <SettingRow
        icon={Moon}
        label="Mode gelap"
        description="Tema akun diterapkan setelah berhasil disimpan"
        right={
          <Switch
            aria-label="Mode gelap"
            checked={theme === "dark"}
            disabled={disabled}
            onCheckedChange={(value) => void save({ theme: value ? "dark" : "light" })}
          />
        }
      />
      <SettingRow
        icon={Sparkles}
        label="Kurangi animasi"
        description={
          preference === "auto"
            ? "Mengikuti setelan perangkat ini"
            : "Disimpan hanya di perangkat ini"
        }
        right={
          <Switch
            aria-label="Kurangi animasi"
            checked={reduced}
            onCheckedChange={(value) => setPreference(value ? "on" : "off")}
          />
        }
      />
      {preference !== "auto" && (
        <div className="px-4 pb-3">
          <Button variant="outline" className="min-h-11" onClick={() => setPreference("auto")}>
            Ikuti animasi perangkat
          </Button>
        </div>
      )}
      <SettingRow
        icon={Eye}
        label="Centang dibaca"
        description="Berlaku untuk pesan TOKOLINK berikutnya; tanda baca lama tetap tersimpan. Tidak mengubah WhatsApp."
        right={
          <Switch
            aria-label="Centang dibaca"
            checked={settings ? privacy.readReceipts : false}
            disabled={disabled}
            onCheckedChange={(value) => void save({ privacy: { readReceipts: value } })}
          />
        }
      />
      <SettingRow
        icon={Palette}
        label="Status online"
        description="Kontrol penyembunyian status belum tersedia. Status online masih dibagikan saat aplikasi aktif."
        right={<span className="shrink-0 text-xs text-muted-foreground">Belum tersedia</span>}
      />
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">Keamanan</h2>
      </div>
      <SettingRow
        icon={Shield}
        label="Kunci aplikasi"
        description="Kunci PIN/biometrik di dalam aplikasi belum tersedia. Gunakan kunci layar perangkat."
        right={<span className="shrink-0 text-xs text-muted-foreground">Belum tersedia</span>}
      />
      <SettingRow
        icon={KeyRound}
        label="Verifikasi dua langkah"
        description="Pendaftaran dan pemeriksaan faktor kedua belum terhubung. Pengaturan ini belum dapat diaktifkan."
        right={<span className="shrink-0 text-xs text-muted-foreground">Belum tersedia</span>}
      />
      <SettingRow
        icon={Shield}
        label="Perlindungan layar"
        description={`${screenSecurity.label} ${screenSecurity.detail}`}
        right={
          <span className="shrink-0 text-xs text-muted-foreground">
            {screenSecurity.flagSecure ? "APK Android" : "Web/PWA"}
          </span>
        }
      />
    </>
  );
}
