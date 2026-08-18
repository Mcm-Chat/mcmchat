import { createFileRoute } from "@tanstack/react-router";
import { BusinessManagePanel } from "@/components/mcm/business/manage-panel";

export const Route = createFileRoute("/business/kelola")({
  head: () => ({
    meta: [
      { title: "Kelola Bisnis — MCM" },
      {
        name: "description",
        content: "Atur data bisnis, profil publik, dan peran anggota tim di hub Bisnis MCM.",
      },
      { property: "og:title", content: "Kelola Bisnis — MCM" },
      { property: "og:description", content: "Data bisnis, profil publik, dan tim MCM." },
    ],
  }),
  component: BusinessManagePanel,
});
