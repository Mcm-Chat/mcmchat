import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, LogOut, Moon, Palette, Shield, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { PinCard } from "@/components/mcm/pin-card";
import { ConfirmDialog, ProtoNote, SettingRow } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMCM } from "@/lib/mcm/store";

export const Route = createFileRoute("/profile/")({
  head: () => ({
    meta: [
      { title: "Profil & Pengaturan — MCM" },
      { name: "description", content: "Kelola profil, PIN MCM, privasi, keamanan, notifikasi, dan tema aplikasi Anda." },
      { property: "og:title", content: "Profil & Pengaturan — MCM" },
      { property: "og:description", content: "Atur privasi, keamanan, dan tampilan MCM." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { state, update, resetDemo } = useMCM();
  const [name, setName] = useState(state.profile.name);
  const [bio, setBio] = useState(state.profile.bio);
  const [reset, setReset] = useState(false);
  const s = state.settings;

  return (
    <AppShell header={<MobileHeader title="Profil" subtitle={state.profile.phoneMasked} />}>
      <div className="space-y-4 px-4 py-4 pb-24">
        <PinCard pin={state.profile.pin} name={state.profile.name} subtitle={state.profile.bio} />

        <div className="card-soft space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="nm">Nama</Label>
            <Input id="nm" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" maxLength={140} value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <Button
            className="w-full rounded-xl"
            onClick={() => {
              if (name.trim().length < 3) { toast.error("Nama minimal 3 karakter"); return; }
              update((d) => {
                d.profile.name = name.trim();
                d.profile.bio = bio.trim();
                return d;
              });
              toast.success("Profil diperbarui");
            }}
          >
            Simpan perubahan
          </Button>
        </div>

        <div className="card-soft divide-y divide-border">
          <SettingRow
            icon={Moon}
            label="Mode gelap"
            description="Sesuaikan tampilan dengan pencahayaan sekitar"
            right={
              <Switch
                checked={s.theme === "dark"}
                onCheckedChange={(v) =>
                  update((d) => {
                    d.settings.theme = v ? "dark" : "light";
                    return d;
                  })
                }
              />
            }
          />
          <SettingRow
            icon={Bell}
            label="Notifikasi chat"
            description="Bunyi dan pratinjau pesan masuk"
            right={
              <Switch
                checked={s.notifications.chat}
                onCheckedChange={(v) =>
                  update((d) => {
                    d.settings.notifications.chat = v;
                    return d;
                  })
                }
              />
            }
          />
          <SettingRow
            icon={Shield}
            label="Kunci aplikasi"
            description="Minta PIN perangkat saat membuka MCM"
            right={
              <Switch
                checked={s.security.appLock}
                onCheckedChange={(v) =>
                  update((d) => {
                    d.settings.security.appLock = v;
                    return d;
                  })
                }
              />
            }
          />
          <SettingRow
            icon={Palette}
            label="Status online"
            description="Tampilkan saat Anda sedang aktif"
            right={
              <Switch
                checked={s.privacy.online}
                onCheckedChange={(v) =>
                  update((d) => {
                    d.settings.privacy.online = v;
                    return d;
                  })
                }
              />
            }
          />
        </div>

        <Button variant="outline" className="w-full rounded-xl" asChild>
          <Link to="/contacts">
            <Users className="size-4" /> Kelola kontak
          </Link>
        </Button>

        <Button variant="outline" className="w-full rounded-xl text-destructive" onClick={() => setReset(true)}>
          <LogOut className="size-4" /> Keluar & atur ulang demo
        </Button>

        <ProtoNote>Data MCM tersimpan di perangkat Anda. Sinkronisasi antar perangkat memerlukan backend.</ProtoNote>
      </div>

      <ConfirmDialog
        open={reset}
        onOpenChange={setReset}
        title="Atur ulang data demo?"
        description="Seluruh perubahan lokal akan dikembalikan ke data demo awal."
        confirmLabel="Atur ulang"
        destructive
        onConfirm={() => {
          resetDemo();
          toast.success("Data demo dikembalikan");
        }}
      />
    </AppShell>
  );
}
