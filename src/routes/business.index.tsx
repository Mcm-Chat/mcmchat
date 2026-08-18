import { createFileRoute } from "@tanstack/react-router";
import { CatalogPanel } from "@/components/mcm/business/catalog-panel";

export const Route = createFileRoute("/business/")({
  head: () => ({
    meta: [
      { title: "Katalog Bisnis — MCM" },
      {
        name: "description",
        content: "Kelola katalog produk, varian, stok gudang, dan indikator laba bisnis Anda.",
      },
      { property: "og:title", content: "Katalog Bisnis — MCM" },
      { property: "og:description", content: "Produk, varian, dan stok gudang bisnis MCM." },
    ],
  }),
  component: CatalogPanel,
});
