import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import logo from "@/assets/mcm-logo.png";
import { useMCM } from "@/lib/mcm/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MCM — Chat Privat, Panggilan & Catatan Utang" },
      {
        name: "description",
        content:
          "Masuk ke MCM: komunikasi privat berbasis PIN, panggilan suara/video, catatan utang-piutang bersama, dan alat bisnis.",
      },
      { property: "og:title", content: "MCM — Chat Privat, Panggilan & Catatan Utang" },
      { property: "og:description", content: "Identitas publik berupa PIN unik. Nomor telepon Anda tidak pernah ditampilkan." },
    ],
  }),
  component: Splash,
});

function Splash() {
  const { state, ready } = useMCM();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (state.authed) navigate({ to: "/chat" });
      else if (state.onboarded) navigate({ to: "/login" });
      else navigate({ to: "/onboarding" });
    }, 1200);
    return () => clearTimeout(t);
  }, [ready, state.authed, state.onboarded, navigate]);

  return (
    <div className="app-gradient flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-navy-foreground">
      <img src={logo} alt="Logo MCM" width={512} height={512} className="size-28 animate-pulse" />
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">MCM</h1>
        <p className="mt-1 text-sm text-navy-foreground/75">Private Chat, Calls & Smart Ledger</p>
      </div>
      <div className="absolute bottom-10 flex items-center gap-2 text-xs text-navy-foreground/70">
        <ShieldCheck className="size-4" /> Privasi terlindungi
      </div>
    </div>
  );
}
