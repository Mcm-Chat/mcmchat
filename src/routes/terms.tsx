import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/mcm/legal-page";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  head: () => ({
    links: canonical("/terms").links,
    meta: [
      ...canonical("/terms").meta,
      { title: "Syarat Layanan — MCM" },
      {
        name: "description",
        content:
          "Ketentuan penggunaan aplikasi chat bisnis MCM: akun, konten, pembayaran, dan penghentian layanan.",
      },
      { property: "og:title", content: "Syarat Layanan — MCM" },
      { property: "og:description", content: "Ketentuan penggunaan aplikasi MCM." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage
      title="Syarat Layanan"
      updatedAt="Februari 2026"
      intro="Dengan membuat akun MCM, Anda menyetujui ketentuan berikut."
      sections={[
        {
          heading: "Akun",
          body: "Anda bertanggung jawab menjaga kerahasiaan kredensial akun dan seluruh aktivitas yang terjadi di dalamnya. Satu orang satu akun, dan data yang Anda daftarkan harus benar.",
        },
        {
          heading: "Penggunaan yang dilarang",
          body: (
            <ul className="list-disc space-y-1 pl-4">
              <li>Mengirim spam, penipuan, atau materi ilegal.</li>
              <li>Melecehkan, mengancam, atau menyebarkan data pribadi orang lain tanpa izin.</li>
              <li>Merekayasa balik, membebani, atau mengganggu layanan.</li>
            </ul>
          ),
        },
        {
          heading: "Konten Anda",
          body: "Anda tetap pemilik konten yang Anda unggah. Anda memberi kami izin terbatas untuk menyimpan dan mengirimkan konten tersebut semata-mata agar layanan berfungsi.",
        },
        {
          heading: "Catatan keuangan",
          body: "Fitur penjualan dan catatan utang-piutang adalah alat pencatatan. MCM bukan lembaga keuangan, tidak memproses pembayaran, dan tidak menjadi pihak dalam transaksi antara Anda dan mitra Anda.",
        },
        {
          heading: "Ketersediaan layanan",
          body: "Kami berupaya menjaga layanan tetap tersedia, namun layanan diberikan apa adanya tanpa jaminan bebas gangguan. Kami dapat melakukan pemeliharaan sewaktu-waktu.",
        },
        {
          heading: "Penghentian",
          body: "Kami dapat menangguhkan akun yang melanggar ketentuan ini. Anda dapat berhenti kapan saja dengan menghapus akun melalui halaman Hapus Akun.",
        },
        {
          heading: "Perubahan",
          body: "Perubahan material atas ketentuan ini akan diberitahukan di dalam aplikasi sebelum berlaku.",
        },
      ]}
    />
  );
}
