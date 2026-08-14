import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/business/")({
  head: () => ({
    meta: [
      { title: "Bisnis — MCM" },
      {
        name: "description",
        content:
          "Modul bisnis MCM kini berada di Katalog untuk produk & stok dan Keuangan untuk penjualan & pesanan.",
      },
      { property: "og:title", content: "Bisnis — MCM" },
      { property: "og:description", content: "Katalog produk, stok, penjualan, dan pesanan MCM." },
    ],
  }),
  component: BusinessRedirect,
});

function BusinessRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/catalog", replace: true });
  }, [navigate]);
  return (
    <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Membuka katalog…
    </div>
  );
}
