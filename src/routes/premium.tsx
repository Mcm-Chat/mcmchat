import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Crown, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";

export const Route = createFileRoute("/premium")({
  head: () => ({
    meta: [
      { title: "MCM Premium — Voice Privacy & Efek Suara" },
      {
        name: "description",
        content:
          "MCM Premium menghadirkan Voice Privacy: efek suara real-time untuk panggilan suara dan video, dengan kontrol penuh dan tanpa penyimpanan sampel suara.",
      },
      { property: "og:title", content: "MCM Premium — Voice Privacy & Efek Suara" },
      {
        property: "og:description",
        content: "Efek suara real-time untuk panggilan MCM. Privasi dulu, tanpa rekaman.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PremiumPage,
});

const BENEFITS = [
  {
    icon: Mic,
    title: "Efek suara real-time",
    desc: "Preset Natural+, Deep, Bright, Warm, Robot ringan, Radio, Privacy, dan Custom saat panggilan berlangsung.",
  },
  {
    icon: Sparkles,
    title: "Kontrol detail",
    desc: "Atur nada, formant, tone, noise gate, peredam derau, volume, dan reverb ringan sesuai kebutuhan.",
  },
  {
    icon: ShieldCheck,
    title: "Privasi dijaga",
    desc: "Efek hanya memproses mikrofon Anda. Tidak ada sampel suara mentah yang disimpan atau dikirim.",
  },
];

function PremiumPage() {
  const { user } = useAuth();
  const ent = useEntitlement(user?.id, FEATURE_VOICE_EFFECTS);

  return (
    <AppShell header={<MobileHeader title="MCM Premium" back />}>
      <div className="space-y-6 p-4">
        <section className="rounded-3xl border bg-gradient-to-br from-primary/15 via-card to-card p-5">
          <Badge className="gap-1 border-0 bg-primary/15 text-primary">
            <Crown className="size-3.5" /> Premium
          </Badge>
          <h1 className="mt-3 text-2xl font-semibold leading-tight">
            Voice Privacy untuk panggilan MCM
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ubah karakter suara Anda secara real-time saat voice call dan video call — untuk
            privasi, kenyamanan, dan aksesibilitas. Anda selalu melihat indikator saat efek sedang
            aktif.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/settings/voice">Coba pratinjau efek</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/calls">Ke panggilan</Link>
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          {BENEFITS.map((b) => (
            <div key={b.title} className="flex gap-3 rounded-2xl border bg-card/60 p-4">
              <b.icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">{b.title}</p>
                <p className="text-xs text-muted-foreground">{b.desc}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border bg-card/60 p-4">
          <p className="text-sm font-semibold">Status langganan</p>
          {ent.loading ? (
            <p className="mt-1 text-xs text-muted-foreground">Memeriksa status…</p>
          ) : ent.active ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" /> Premium aktif
              {ent.expiresAt
                ? ` sampai ${new Date(ent.expiresAt).toLocaleDateString("id-ID")}`
                : ""}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Penagihan belum terhubung. MCM tidak mengaktifkan langganan palsu — begitu penyedia
              pembayaran disambungkan, entitlement premium akan muncul otomatis di sini.
            </p>
          )}
        </section>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Voice Privacy dirancang untuk menyamarkan warna suara Anda sendiri. Fitur ini tidak
          menyediakan kloning suara, peniruan orang tertentu, maupun cara melewati verifikasi suara.
        </p>
      </div>
    </AppShell>
  );
}
