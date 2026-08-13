import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Mail, ShieldCheck, Trash2 } from "lucide-react";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/support")({
  head: () => ({
    links: canonical("/support").links,
    meta: [
      ...canonical("/support").meta,
      { title: "Bantuan & Dukungan — MCM" },
      { name: "description", content: "Pusat bantuan MCM: PIN, chat, katalog, penyiapan pegawai, catatan utang, dan kontak dukungan." },
      { property: "og:title", content: "Bantuan & Dukungan — MCM" },
      { property: "og:description", content: "Jawaban cepat seputar pemakaian MCM." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupportPage,
});

const FAQ = [
  {
    q: "Apa itu PIN MCM?",
    a: "PIN adalah identitas publik Anda di MCM, misalnya M7K9-X2PF. Nomor telepon dan email tidak pernah ditampilkan. Bagikan PIN atau QR Anda agar orang lain bisa mengirim permintaan kontak.",
  },
  {
    q: "Bagaimana menambah kontak?",
    a: "Buka Profil → Kontak → Tambah, lalu masukkan PIN tepat seperti tertulis atau pindai QR. Permintaan baru terkirim setelah pemilik PIN menyetujui.",
  },
  {
    q: "Bagaimana mengirim foto beserta lokasi?",
    a: "Di ruang chat tekan tombol + lalu pilih Foto. Aktifkan opsi lokasi sebelum mengirim, maka foto dan titik lokasinya terkirim dalam satu gelembung pesan.",
  },
  {
    q: "Apa itu perintah penyiapan pegawai?",
    a: "Pemilik atau admin bisnis membuat perintah berisi produk, varian, dan jumlah, lalu mengirimkan tautan/QR unik ke pegawai. Pegawai memotret hasil penyiapan dengan lokasi, dan saat tugas diselesaikan stok terpotong otomatis serta foto masuk ke katalog.",
  },
  {
    q: "Apakah stok dan penjualan aman dari pencatatan ganda?",
    a: "Ya. Penjualan dan pemotongan stok berjalan dalam satu transaksi dengan kunci idempotensi, sehingga menekan tombol dua kali atau koneksi terputus tidak membuat catatan ganda.",
  },
  {
    q: "Bagaimana catatan utang-piutang bekerja?",
    a: "Catatan dibuat oleh satu pihak dan menunggu persetujuan pihak lain. Setelah disetujui, kedua pihak melihat sisa tagihan yang sama dan setiap pembayaran tercatat pada riwayat.",
  },
  {
    q: "Kenapa panggilan belum bisa dipakai?",
    a: "Kredensial penyedia panggilan suara/video belum dikonfigurasi pada proyek ini. Riwayat panggilan tetap tersimpan, dan fitur akan aktif begitu kredensial ditambahkan.",
  },
  {
    q: "Bagaimana menghapus pesan?",
    a: "Tekan dan tahan pesan lalu pilih Hapus untuk saya atau Hapus untuk semua. Pesan yang dihapus untuk semua hilang sepenuhnya tanpa meninggalkan jejak teks.",
  },
];

function SupportPage() {
  return (
    <AppShell nav={false} header={<MobileHeader title="Bantuan & Dukungan" subtitle="Panduan singkat MCM" back />}>
      <div className="space-y-5 px-4 py-5 pb-10">
        <Accordion type="single" collapsible className="rounded-2xl border border-border bg-card px-3">
          {FAQ.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-left text-sm">{f.q}</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Masih butuh bantuan?</h2>
          <p className="text-sm text-muted-foreground">
            Kirim email berisi PIN Anda dan penjelasan masalahnya. Kami membalas pada hari kerja.
          </p>
          <Button asChild className="w-full">
            <a href="mailto:support@mcm.app?subject=Bantuan%20MCM">
              <Mail className="size-4" /> Hubungi dukungan
            </a>
          </Button>
        </div>

        <div className="grid gap-2">
          <Button asChild variant="outline" className="justify-start">
            <Link to="/privacy">
              <ShieldCheck className="size-4" /> Kebijakan Privasi
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-start">
            <Link to="/terms">
              <ShieldCheck className="size-4" /> Syarat Layanan
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-start text-destructive">
            <Link to="/delete-account">
              <Trash2 className="size-4" /> Hapus akun
            </Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
