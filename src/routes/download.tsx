import { createFileRoute, Link } from "@tanstack/react-router";
import { Smartphone, ShieldCheck, Bell, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Unduh MCM untuk Android" },
      {
        name: "description",
        content:
          "Unduh aplikasi MCM: chat privat, panggilan suara & video, Status, katalog produk, dan buku besar bisnis dalam satu aplikasi Android.",
      },
      { property: "og:title", content: "Unduh MCM untuk Android" },
      { property: "og:description", content: "Chat privat, panggilan, dan pembukuan bisnis MCM di ponsel Anda." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DownloadPage,
});

const FEATURES = [
  { icon: ShieldCheck, title: "Privasi kelas produksi", desc: "Proteksi tangkapan layar, foto profil beraturan privasi, dan enkripsi transportasi." },
  { icon: Bell, title: "Notifikasi interaktif", desc: "Balas pesan dan tandai dibaca langsung dari notifikasi Android." },
  { icon: Wallet, title: "Bisnis dalam chat", desc: "Katalog, stok, penyiapan pegawai, penjualan, dan buku besar menyatu di ruang chat." },
];

function DownloadPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-background px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Unduh MCM</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        MCM — Private Chat, Calls &amp; Smart Ledger untuk Android. Versi web dapat langsung dipakai tanpa memasang apa pun.
      </p>

      <div className="card-soft mt-6 space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="size-4 text-primary" /> Aplikasi Android
        </div>
        <p className="text-xs text-muted-foreground">
          Rilis Play Store sedang dalam proses peninjauan. Sementara itu, pasang MCM sebagai aplikasi layar utama
          melalui menu browser: <em>Tambahkan ke layar utama</em>.
        </p>
        <Button asChild className="w-full rounded-xl">
          <Link to="/">Buka MCM versi web</Link>
        </Button>
      </div>

      <section className="mt-6 space-y-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card-soft flex gap-3 p-4">
            <f.icon className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="text-xs text-muted-foreground">{f.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <nav className="mt-8 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Link to="/privacy">Kebijakan privasi</Link>
        <Link to="/terms">Syarat &amp; ketentuan</Link>
        <Link to="/delete-account">Hapus akun</Link>
      </nav>
    </main>
  );
}