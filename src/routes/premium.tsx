import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Crown, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";
import { PremiumCheckoutDialog } from "@/components/mcm/premium-checkout-dialog";
import {
  clearSimulation,
  PREMIUM_PLANS,
  readSimulation,
  rupiah,
  type PremiumPlan,
  type PremiumSimulation,
} from "@/lib/premium/plans";
import { cn } from "@/lib/utils";

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
  const [checkout, setCheckout] = useState<PremiumPlan | null>(null);
  const [sim, setSim] = useState<PremiumSimulation | null>(null);

  useEffect(() => setSim(readSimulation()), []);
  const refreshSim = useCallback(() => setSim(readSimulation()), []);

  return (
    <AppShell header={<MobileHeader title="MCM Premium" back />}>
      <div className="space-y-6 p-4">
        <section className="rounded-3xl border bg-gradient-to-br from-primary/15 via-card to-card p-5">
          <Badge className="gap-1 border-0 bg-primary/15 text-primary">
            <Crown className="size-3.5" /> Premium
          </Badge>
          <h2 className="mt-3 text-2xl font-semibold leading-tight">
            Voice Privacy untuk panggilan MCM
          </h2>
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

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Pilih paket</h2>
          {PREMIUM_PLANS.map((p) => (
            <div
              key={p.id}
              className={cn(
                "rounded-2xl border bg-card/60 p-4",
                p.highlight && "border-primary/50 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.note}</p>
                </div>
                {p.highlight && (
                  <Badge className="shrink-0 border-0 bg-primary/15 text-primary">Populer</Badge>
                )}
              </div>
              <p className="mt-2 text-xl font-bold">
                {rupiah(p.price)}
                <span className="text-xs font-normal text-muted-foreground">{p.period}</span>
              </p>
              <ul className="mt-3 space-y-1.5">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    {perk}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-4 w-full"
                variant={p.highlight ? "default" : "secondary"}
                onClick={() => setCheckout(p)}
              >
                Upgrade ke {p.name}
              </Button>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">
            Tombol upgrade menjalankan simulasi alur pembayaran (mode uji). Tidak ada penagihan
            nyata sampai penyedia pembayaran tersambung.
          </p>
        </section>

        <section className="rounded-2xl border bg-card/60 p-4">
          <p className="text-sm font-semibold">Status langganan</p>
          {ent.loading ? (
            <p className="mt-1 text-xs text-muted-foreground">Memeriksa status…</p>
          ) : ent.active ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-success">
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
          {sim && (
            <div className="mt-3 rounded-xl bg-muted/60 p-3">
              <p className="text-xs font-medium">
                Simulasi terakhir:{" "}
                {PREMIUM_PLANS.find((p) => p.id === sim.planId)?.name ?? sim.planId} •{" "}
                {sim.method}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(sim.at).toLocaleString("id-ID")} — catatan uji lokal, bukan langganan
                aktif.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-8 px-2 text-xs"
                onClick={() => {
                  clearSimulation();
                  setSim(null);
                }}
              >
                Hapus catatan simulasi
              </Button>
            </div>
          )}
        </section>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Voice Privacy dirancang untuk menyamarkan warna suara Anda sendiri. Fitur ini tidak
          menyediakan kloning suara, peniruan orang tertentu, maupun cara melewati verifikasi suara.
        </p>
      </div>
      <PremiumCheckoutDialog
        plan={checkout}
        onOpenChange={(open) => !open && setCheckout(null)}
        onDone={refreshSim}
      />
    </AppShell>
  );
}
