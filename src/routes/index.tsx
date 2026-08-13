import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import logo from "@/assets/mcm-logo.png";
import { useAuth } from "@/lib/auth";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/")({
  head: () => ({
    links: canonical("/").links,
    meta: [
      ...canonical("/").meta,
      { title: "MCM — Chat Privat, Panggilan & Catatan Utang" },
      {
        name: "description",
        content:
          "Masuk ke MCM: komunikasi privat berbasis PIN, panggilan suara/video, catatan utang-piutang bersama, dan alat bisnis.",
      },
      { property: "og:title", content: "MCM — Chat Privat, Panggilan & Catatan Utang" },
      {
        property: "og:description",
        content: "Identitas publik berupa PIN unik. Nomor telepon Anda tidak pernah ditampilkan.",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "MCM",
              url: "https://mcmchat.id",
              logo: "https://mcmchat.id/icon-512.png",
            },
            {
              "@type": "SoftwareApplication",
              name: "MCM — Private Chat, Calls & Smart Ledger",
              applicationCategory: "CommunicationApplication",
              operatingSystem: "Android, Web",
              url: "https://mcmchat.id",
              description:
                "Chat privat berbasis PIN, panggilan suara & video, catatan utang-piutang bersama, serta katalog dan keuangan bisnis.",
              featureList: [
                "Chat privat berbasis PIN",
                "Panggilan suara dan video",
                "Catatan utang-piutang bersama",
                "Katalog produk dan stok",
                "Penyiapan pesanan pegawai",
              ],
            },
          ],
        }),
      },
    ],
  }),
  component: Splash,
});

function Splash() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    const seen = typeof window !== "undefined" && localStorage.getItem("mcm-onboarded") === "1";
    const t = setTimeout(() => {
      if (session) void navigate({ to: "/chat", replace: true });
      else if (seen) void navigate({ to: "/login", replace: true });
      else void navigate({ to: "/onboarding", replace: true });
    }, 700);
    return () => clearTimeout(t);
  }, [loading, session, navigate]);

  return (
    <div className="app-gradient flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-navy-foreground">
      <img src={logo} alt="Logo MCM" width={512} height={512} className="size-28 animate-pulse" />
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">
          MCM — Chat Privat, Panggilan &amp; Catatan Utang
        </h1>
        <p className="mt-1 text-sm text-navy-foreground/75">
          Private Chat, Calls &amp; Smart Ledger
        </p>
      </div>
      <div className="absolute bottom-10 flex items-center gap-2 text-xs text-navy-foreground/70">
        <ShieldCheck className="size-4" /> Privasi terlindungi
      </div>
    </div>
  );
}
