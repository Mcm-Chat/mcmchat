import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Beranda MCM" },
      {
        name: "description",
        content: "Beranda MCM mengarahkan Anda ke daftar chat, panggilan, catatan, dan bisnis.",
      },
      { property: "og:title", content: "Beranda MCM" },
      { property: "og:description", content: "Pusat navigasi aplikasi MCM." },
    ],
  }),
  component: HomeRedirect,
});

function HomeRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/chat", replace: true });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Membuka beranda…
    </div>
  );
}
