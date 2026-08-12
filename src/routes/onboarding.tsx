import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, MessagesSquare, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/mcm-logo.png";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Kenalan dengan MCM — Onboarding" },
      { name: "description", content: "Tiga langkah singkat memahami PIN privat, chat aman, dan catatan utang bersama di MCM." },
      { property: "og:title", content: "Kenalan dengan MCM" },
      { property: "og:description", content: "PIN privat, chat & panggilan, serta catatan utang-piutang bersama." },
    ],
  }),
  component: Onboarding,
});

const SLIDES = [
  {
    icon: KeyRound,
    title: "Identitas Anda cukup sebuah PIN",
    body: "Orang lain menemukan Anda lewat PIN MCM 8 karakter. Nomor telepon dan email tidak pernah ditampilkan.",
  },
  {
    icon: MessagesSquare,
    title: "Chat & panggilan yang rapi",
    body: "Chat personal dan grup, lampiran, pesan suara, serta panggilan suara dan video dalam satu aplikasi.",
  },
  {
    icon: Wallet,
    title: "Catatan utang yang disepakati bersama",
    body: "Buat catatan utang-piutang langsung dari chat. Pihak kedua harus menyetujui sebelum catatan aktif.",
  },
];

function Onboarding() {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const slide = SLIDES[index]!;
  const Icon = slide.icon;

  const finish = () => {
    localStorage.setItem("mcm-onboarded", "1");
    void navigate({ to: "/register" });
  };

  return (
    <div className="app-gradient min-h-screen text-navy-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-10">
        <div className="flex items-center justify-between">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="size-10" loading="lazy" />
          <Button variant="ghost" className="text-navy-foreground hover:bg-white/10" onClick={finish}>
            Lewati
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <div className="flex size-24 items-center justify-center rounded-3xl bg-white/12">
            <Icon className="size-11" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{slide.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-navy-foreground/80">{slide.body}</p>
          </div>
          <div className="flex gap-2">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className={cn("h-1.5 rounded-full transition-all", i === index ? "w-6 bg-primary" : "w-1.5 bg-white/30")}
              />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Button
            className="h-12 w-full rounded-2xl text-base"
            onClick={() => (index < SLIDES.length - 1 ? setIndex(index + 1) : finish())}
          >
            {index < SLIDES.length - 1 ? "Lanjut" : "Mulai sekarang"}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-navy-foreground hover:bg-white/10"
            onClick={() => {
              localStorage.setItem("mcm-onboarded", "1");
              void navigate({ to: "/login" });
            }}
          >
            Saya sudah punya akun
          </Button>
        </div>
      </div>
    </div>
  );
}
