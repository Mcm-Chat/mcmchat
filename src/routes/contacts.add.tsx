import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { PinCard } from "@/components/mcm/pin-card";
import { QrScannerDialog } from "@/components/mcm/lazy-heavy";
import { ScanResultSheet } from "@/components/mcm/scan-result-sheet";
import { PinField } from "@/components/mcm/pin-picker";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  findByPin,
  getContactRelation,
  isValidPin,
  normalizePin,
  sendContactRequest,
  type ContactRelation,
  type ProfileLite,
} from "@/lib/api/contacts";
import { useRequireAuth } from "@/lib/api/guard";
import { buildAccessPrefill } from "@/lib/contacts/access-request";
import { ContactRequestConfirmDialog } from "@/components/mcm/contact-request-confirm";

export const Route = createFileRoute("/contacts/add")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { conv?: string; reason?: string; scan?: boolean } => {
    const out: { conv?: string; reason?: string; scan?: boolean } = {};
    if (typeof search['conv'] === "string") out.conv = search['conv'];
    if (typeof search['reason'] === "string") out.reason = search['reason'];
    if (search['scan'] === true || search['scan'] === "1" || search['scan'] === "true")
      out.scan = true;
    return out;
  },
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
  const { conv, reason, scan } = Route.useSearch();
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [relation, setRelation] = useState<ContactRelation | null>(null);

  // Status relasi selalu disegarkan setiap profil hasil pencarian berubah agar
  // badge yang tampil benar-benar mencerminkan kondisi di server.
  useEffect(() => {
    if (!found || !userId) {
      setRelation(null);
      return;
    }
    let alive = true;
    void getContactRelation(userId, found.id)
      .then((r) => alive && setRelation(r))
      .catch(() => alive && setRelation(null));
    return () => {
      alive = false;
    };
  }, [found, userId]);

  // Buka pemindai QR langsung saat masuk lewat pintasan "Pindai QR".
  useEffect(() => {
    if (scan) setScannerOpen(true);
  }, [scan]);

  // Prefill dari CTA "Minta akses ke kontak": identitas percakapan diisi
  // otomatis sehingga tombol kirim langsung tersedia.
  useEffect(() => {
    if (!conv || !userId) return;
    let alive = true;
    void buildAccessPrefill(conv, userId, reason).then((prefill) => {
      if (!alive) return;
      setMessage(prefill.message);
      if (prefill.profile) {
        setFound(prefill.profile);
        setSearched(true);
        if (prefill.profile.pin) setPin(normalizePin(prefill.profile.pin));
      } else {
        toast.info("Masukkan PIN kontak untuk mengirim permintaan akses.");
      }
    });
    return () => {
      alive = false;
    };
  }, [conv, userId, reason]);

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
      const res = await sendContactRequest(userId, found.id, message.trim());
      const code = res.code ?? res.status ?? "created";
      // Form hanya dikosongkan bila kontak benar-benar tersimpan/terhubung.
      const savedForReal = code === "accepted_incoming" || code === "accepted";
      if (savedForReal) {
        toast.success("Kontak tersimpan — permintaan mereka langsung diterima.");
      } else if (code === "incoming_pending") {
        toast.info("Mereka sudah mengirim permintaan. Buka Kontak → Masuk untuk menerima.");
      } else if (code === "already_pending" || code === "pending") {
        toast.info("Permintaan sebelumnya masih menunggu jawaban. Belum tersimpan sebagai kontak.");
      } else if (code === "already_connected") {
        toast.info("Kalian sudah terhubung.");
      } else {
        toast.success("Permintaan kontak terkirim — menunggu jawaban mereka.");
      }
      setConfirmOpen(false);
      if (savedForReal) {
        setFound(null);
        setSearched(false);
        setRelation(null);
        setPin("");
      } else {
        // Pertahankan form dan segarkan badge status supaya pengguna tahu
        // posisi permintaan tanpa kehilangan pesan yang sudah diketik.
        try {
          setRelation(await getContactRelation(userId, found.id));
        } catch {
          /* badge dibiarkan apa adanya bila status gagal dimuat */
        }
      }
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
            <PinField
              id="pin"
              value={pin}
              onChange={(v) => setPin(normalizePin(v))}
              onPickContact={(c) => void search(c.pin)}
              placeholder="A2B3-C4D5"
              maxLength={9}
              inputClassName="font-mono tracking-widest uppercase"
              action={
                <Button
                  className="h-11 rounded-xl"
                  onClick={() => void search()}
                  disabled={searching || !pin}
                >
                  <Search className="size-4" /> {searching ? "Mencari…" : "Cari"}
                </Button>
              }
            />
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
            <Button
              className="w-full rounded-xl"
              onClick={() => setConfirmOpen(true)}
              disabled={sending}
            >
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
      <ContactRequestConfirmDialog
        open={confirmOpen}
        profile={found}
        message={message}
        reason={reason}
        conversationId={conv}
        sending={sending}
        onConfirm={() => void send()}
        onOpenChange={setConfirmOpen}
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
