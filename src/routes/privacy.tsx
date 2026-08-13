import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/mcm/legal-page";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    links: canonical("/privacy").links,
    meta: [
      ...canonical("/privacy").meta,
      { title: "Kebijakan Privasi — MCM" },
      {
        name: "description",
        content: "Bagaimana MCM mengumpulkan, memakai, menyimpan, dan menghapus data Anda.",
      },
      { property: "og:title", content: "Kebijakan Privasi — MCM" },
      { property: "og:description", content: "Kebijakan privasi aplikasi chat bisnis MCM." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage
      title="Kebijakan Privasi"
      updatedAt="Februari 2026"
      intro="MCM adalah aplikasi komunikasi dan pencatatan bisnis. Kami hanya mengumpulkan data yang diperlukan agar layanan berjalan, dan tidak menjual data Anda kepada pihak ketiga."
      sections={[
        {
          heading: "Data yang kami kumpulkan",
          body: (
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Identitas akun: email untuk masuk, nama tampilan, bio, foto profil, dan PIN unik
                MCM.
              </li>
              <li>
                Isi komunikasi: pesan teks, foto, dokumen, pesan suara, dan reaksi yang Anda kirim.
              </li>
              <li>
                Lokasi: hanya saat Anda menekan tombol kirim lokasi atau memotret produk dengan opsi
                lokasi aktif.
              </li>
              <li>
                Data bisnis: katalog produk, stok, pesanan, penjualan, catatan utang-piutang, dan
                perintah penyiapan.
              </li>
              <li>Data teknis: perangkat aktif dan waktu akses terakhir untuk keamanan akun.</li>
            </ul>
          ),
        },
        {
          heading: "Bagaimana data dipakai",
          body: "Data dipakai untuk mengirimkan pesan ke penerima yang Anda tuju, menampilkan katalog dan stok, menghitung penjualan serta utang-piutang, dan menjaga keamanan akun. Kami tidak memakai isi pesan Anda untuk iklan.",
        },
        {
          heading: "Berbagi data",
          body: "Isi percakapan hanya dibagikan kepada peserta percakapan tersebut. Data bisnis hanya dapat diakses oleh anggota bisnis sesuai perannya. Penyedia infrastruktur kami memproses data atas nama kami dengan kewajiban kerahasiaan.",
        },
        {
          heading: "Nomor telepon dan email",
          body: "Email hanya dipakai untuk autentikasi dan pemulihan akun. Email dan nomor telepon tidak pernah ditampilkan sebagai identitas publik — pengguna lain hanya melihat PIN dan nama tampilan Anda.",
        },
        {
          heading: "Penyimpanan dan keamanan",
          body: "Data disimpan pada basis data terkelola dengan kontrol akses baris (row level security), dan berkas media disimpan pada penyimpanan privat yang hanya bisa dibuka melalui tautan bertanda tangan berbatas waktu.",
        },
        {
          heading: "Hak Anda",
          body: "Anda dapat memperbarui profil kapan saja, menghapus pesan untuk diri sendiri atau untuk semua orang, mengeluarkan perangkat yang tidak dikenal, dan meminta penghapusan akun beserta seluruh datanya melalui halaman Hapus Akun.",
        },
        {
          heading: "Anak-anak",
          body: "MCM tidak ditujukan untuk pengguna di bawah 13 tahun.",
        },
        {
          heading: "Kontak",
          body: "Pertanyaan privasi dapat dikirim melalui halaman Bantuan di dalam aplikasi.",
        },
      ]}
    />
  );
}
