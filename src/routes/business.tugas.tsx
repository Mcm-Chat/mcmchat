import { createFileRoute } from "@tanstack/react-router";
import { TasksPanel } from "@/components/mcm/business/tasks-panel";

export const Route = createFileRoute("/business/tugas")({
  head: () => ({
    meta: [
      { title: "Tugas Penyiapan — MCM" },
      {
        name: "description",
        content: "Kirim dan pantau perintah penyiapan barang untuk pegawai bisnis Anda.",
      },
      { property: "og:title", content: "Tugas Penyiapan — MCM" },
      { property: "og:description", content: "Perintah penyiapan pegawai di hub Bisnis MCM." },
    ],
  }),
  component: TasksPanel,
});
