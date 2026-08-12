import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { QrCode, ScanLine, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { MCMAvatar, ProtoNote } from "@/components/mcm/primitives";
import { QRCard, copyText } from "@/components/mcm/pin-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEMO_DIRECTORY, PIN_ALPHABET } from "@/lib/mcm/demo";
import { uid, useMCM } from "@/lib/mcm/store";
import type { Contact } from "@/lib/mcm/types";

export const Route = createFileRoute("/contacts/add")({
  head: () => ({
    meta: [
      { title: "Tambah kontak lewat PIN — MCM" },
      { name: "description", content: "Cari pengguna MCM dengan PIN 8 karakter atau bagikan QR PIN Anda untuk dipindai." },
      { property: "og:title", content: "Tambah kontak lewat PIN — MCM" },
      { property: "og:description", content: "Tambah teman tanpa bertukar nomor telepon." },
    ],
  }),
  component: AddContactPage,
});

const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
const format = (v: string) => (v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v);

function AddContactPage() {
  const { state, update } = useMCM();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("Halo, saya ingin terhubung di MCM.");
  const [result, setResult] = useState<Contact | "notfound" | null>(null);

  const raw = normalize(pin);
  const valid = raw.length === 8 && [...raw].every((ch) => PIN_ALPHABET.includes(ch));

  const doSearch = () => {
    if (!valid) {
      toast.error("PIN harus 8 karakter dan tanpa huruf O/I atau angka 0/1");
      return;
    }
    const formatted = format(raw);
    if (formatted === state.profile.pin) {
      toast.error("Itu PIN Anda sendiri");
      return;
    }
    const found = state.contacts.find((c) => c.pin === formatted);
    if (found) {
      setResult(found);
      return;
    }
    const dir = DEMO_DIRECTORY.find((d) => d.pin === formatted);
    if (dir) {
      setResult({
        id: uid("ct"),
        name: dir.name,
        pin: dir.pin,
        bio: dir.bio,
        avatarColor: dir.avatarColor,
        initials: dir.initials,
        status: "outgoing",
        lastSeen: new Date().toISOString(),
      });
      return;
    }
    setResult({
      id: uid("ct"),
      name: `Pengguna ${raw.slice(0, 4)}`,
      pin: formatted,
      bio: "Pengguna MCM",
      avatarColor: "from-sky-500 to-indigo-600",
      initials: raw.slice(0, 2),
      status: "outgoing",
      lastSeen: new Date().toISOString(),
    });
  };

  const sendRequest = () => {
    if (!result || result === "notfound") return;
    if (result.status === "contact") {
      toast.info("Sudah menjadi kontak Anda");
      navigate({ to: "/contacts" });
      return;
    }
    update((d) => {
      if (!d.contacts.some((c) => c.pin === result.pin)) {
        d.contacts.push({ ...result, status: "outgoing", requestMessage: message.trim().slice(0, 140) });
      }
      return d;
    });
    toast.success("Permintaan pertemanan terkirim");
    navigate({ to: "/contacts" });
  };

  return (
    <AppShell nav={false} header={<MobileHeader back title="Tambah kontak" subtitle="Gunakan PIN MCM, bukan nomor telepon" />}>
      <div className="space-y-4 px-4 py-4">
        <Tabs defaultValue="pin">
          <TabsList className="w-full rounded-xl">
            <TabsTrigger value="pin" className="flex-1 rounded-lg">
              Cari PIN
            </TabsTrigger>
            <TabsTrigger value="qr" className="flex-1 rounded-lg">
              QR saya
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pin" className="mt-4 space-y-4">
            <div className="card-soft space-y-3 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="pin">PIN MCM (8 karakter)</Label>
                <Input
                  id="pin"
                  value={format(raw)}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="XXXX-XXXX"
                  className="h-12 rounded-xl text-center font-mono text-lg tracking-[0.25em]"
                />
                <p className="text-[11px] text-muted-foreground">Tanpa karakter membingungkan: 0, O, I, dan 1 tidak dipakai.</p>
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => setPin("R8NA-K4Q7")}
                >
                  Coba PIN contoh: R8NA-K4Q7 (Rina Safitri)
                </button>
              </div>
              <Button className="h-11 w-full rounded-xl" onClick={doSearch} disabled={!valid}>
                <Search className="size-4" /> Cari pengguna
              </Button>
              <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => toast.info("Pemindai QR memerlukan izin kamera perangkat (simulasi)")}>
                <ScanLine className="size-4" /> Pindai QR
              </Button>
            </div>

            {result && result !== "notfound" && (
              <div className="card-soft space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <MCMAvatar initials={result.initials} color={result.avatarColor} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{result.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{result.pin}</p>
                    <p className="truncate text-xs text-muted-foreground">{result.bio}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="msg">Pesan permintaan</Label>
                  <Textarea id="msg" value={message} maxLength={140} onChange={(e) => setMessage(e.target.value)} />
                  <p className="text-right text-[11px] text-muted-foreground">{message.length}/140</p>
                </div>
                <Button className="h-11 w-full rounded-xl" onClick={sendRequest}>
                  <Send className="size-4" /> Kirim permintaan
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="qr" className="mt-4 space-y-4">
            <QRCard pin={state.profile.pin} label={state.profile.name} />
            <Button variant="outline" className="w-full rounded-xl" onClick={() => copyText(state.profile.pin, "PIN disalin")}>
              <QrCode className="size-4" /> Salin PIN saya
            </Button>
          </TabsContent>
        </Tabs>

        <ProtoNote>Pencarian PIN masih memakai data demo di perangkat. Direktori pengguna nyata memerlukan backend.</ProtoNote>
      </div>
    </AppShell>
  );
}
