import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { MCMAvatar } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { PinCard } from "@/components/mcm/pin-card";
import { QrScannerDialog } from "@/components/mcm/qr-scanner";
import { ScanResultSheet } from "@/components/mcm/scan-result-sheet";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  findByPin,
  isValidPin,
  normalizePin,
  sendContactRequest,
  type ProfileLite,
} from "@/lib/api/contacts";
import { useRequireAuth } from "@/lib/api/guard";

export const Route = createFileRoute("/contacts/add")({
  head: () => ({
    meta: [
      { title: "Tambah kontak lewat PIN — MCM" },
      {
        name: "description",
        content: "Cari pengguna MCM dengan PIN 8 karakter atau bagikan QR PIN Anda untuk dipindai.",
      },
      { property: "og:title", content: "Tambah kontak lewat PIN — MCM" },
      { property: "og:description", content: "Tambah teman tanpa bertukar nomor telepon." },
    ],
  }),
  component: AddContactPage,
});

function AddContactPage() {
  const { userId, profile } = useRequireAuth();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("Halo, saya ingin terhubung di MCM.");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [found, setFound] = useState<ProfileLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanned, setScanned] = useState<ProfileLite | null>(null);
  const [temporary, setTemporary] = useState<ProfileLite | null>(null);

  const handleScan = async (value: string) => {
    setPin(value);
    if (profile && normalizePin(value) === normalizePin(profile.pin)) {
      toast.info("Ini adalah PIN Anda sendiri.");
      return;
    }
    try {
      const result = await findByPin(value);
      if (!result) {
        toast.error("Pengguna tidak ditemukan.");
        setSearched(true);
        return;
      }
      setScanned(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pengguna tidak ditemukan.");
    }
  };

  const search = async (value: string = pin) => {
    if (!isValidPin(value)) {
      toast.error("Format PIN tidak valid. Contoh: A2B3-C4D5");
      return;
    }
    setSearching(true);
    setError(null);
    setFound(null);
    setSearched(false);
    try {
      const result = await findByPin(value);
      setFound(result);
      setSearched(true);
      if (!result) toast.info("PIN tidak ditemukan. Periksa kembali kode PIN.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pencarian gagal");
    } finally {
      setSearching(false);
    }
  };

  const send = async () => {
    if (!userId || !found) return;
    setSending(true);
    try {
      await sendContactRequest(userId, found.id, message.trim());
      toast.success("Permintaan kontak terkirim");
      setFound(null);
      setSearched(false);
      setPin("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permintaan gagal dikirim");
    } finally {
      setSending(false);
    }
  };

  return (
    <AppShell
      nav={false}
      header={
        <MobileHeader back title="Tambah kontak" subtitle="Cari lewat PIN, bukan nomor telepon" />
      }
    >
      <div className="space-y-4 px-4 py-4 pb-10">
        {profile && (
          <PinCard
            pin={profile.pin}
            name={profile.display_name}
            subtitle="Bagikan PIN ini agar orang lain bisa menambahkan Anda"
          />
        )}

        <div className="card-soft space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN MCM</Label>
            <div className="flex gap-2">
              <Input
                id="pin"
                value={pin}
                onChange={(e) => setPin(normalizePin(e.target.value))}
                placeholder="A2B3-C4D5"
                maxLength={9}
                className="h-11 rounded-xl font-mono tracking-widest uppercase"
              />
              <Button
                className="h-11 rounded-xl"
                onClick={() => void search()}
                disabled={searching || !pin}
              >
                <Search className="size-4" /> {searching ? "Mencari…" : "Cari"}
              </Button>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full rounded-xl"
            onClick={() => setScannerOpen(true)}
          >
            <Camera className="size-4" /> Pindai QR dengan kamera
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Kamera hanya dipakai untuk membaca QR; tidak ada foto yang disimpan.
          </p>
        </div>

        {searched && !found && !error && (
          <div className="card-soft p-4 text-center text-sm text-muted-foreground">
            PIN tidak ditemukan. Pastikan PIN benar dan coba lagi.
          </div>
        )}

        {found && (
          <div className="card-soft space-y-3 p-4">
            <div className="flex items-center gap-3">
              <UserAvatar
                userId={found.id}
                path={found.avatar_url}
                version={found.avatar_version}
                name={found.display_name}
                color={found.avatar_color}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{found.display_name}</p>
                <p className="font-mono text-xs text-muted-foreground">{found.pin}</p>
                {found.bio && <p className="truncate text-xs text-muted-foreground">{found.bio}</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="msg">Pesan permintaan</Label>
              <Textarea
                id="msg"
                maxLength={140}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
              />
            </div>
            <Button className="w-full rounded-xl" onClick={() => void send()} disabled={sending}>
              <Send className="size-4" /> {sending ? "Mengirim…" : "Kirim permintaan"}
            </Button>
          </div>
        )}
        {temporary && (
          <div className="card-soft space-y-2 p-4">
            <p className="text-xs text-muted-foreground">
              Dipakai sementara (tidak disimpan ke kontak)
            </p>
            <div className="flex items-center gap-3">
              <UserAvatar
                userId={temporary.id}
                path={temporary.avatar_url}
                version={temporary.avatar_version}
                name={temporary.display_name}
                color={temporary.avatar_color}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{temporary.display_name}</p>
                <p className="font-mono text-xs text-muted-foreground">{temporary.pin}</p>
              </div>
              <Button
                variant="ghost"
                className="h-11 rounded-xl"
                onClick={() => setTemporary(null)}
              >
                Selesai
              </Button>
            </div>
          </div>
        )}
      </div>

      <QrScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onResult={(value) => void handleScan(value)}
      />
      {userId && (
        <ScanResultSheet
          open={!!scanned}
          profile={scanned}
          userId={userId}
          onOpenChange={(v) => !v && setScanned(null)}
          onScanAgain={() => setScannerOpen(true)}
          onManualPin={() => document.getElementById("pin")?.focus()}
          onUseWithoutSaving={({ profile: p }) => setTemporary(p)}
        />
      )}
    </AppShell>
  );
}
