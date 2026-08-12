import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, Loader2, Mic, MicOff, RotateCcw, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  LIMITS,
  PARAM_LABEL,
  PRESETS,
  type PresetId,
  type VoiceParams,
  type VoicePrefs,
} from "@/lib/voice/presets";
import { useVoicePreview } from "@/lib/voice/use-voice-preview";
import type { EntitlementState } from "@/lib/api/entitlements";

/** Batas pratinjau gratis agar entry point tetap terlihat tanpa membuka fitur penuh. */
const FREE_PREVIEW_SECONDS = 15;

export function VoicePrivacyBadge({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <Badge
      className={cn("gap-1 border-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", className)}
      aria-live="polite"
    >
      <ShieldCheck className="size-3.5" />
      Voice Privacy aktif
    </Badge>
  );
}

const CUSTOM_KEYS: (keyof VoiceParams)[] = ["pitch", "formant", "tone", "gate", "denoise", "gain", "reverb"];

export function VoiceEffectsPanel({
  prefs,
  onChange,
  entitlement,
  compact,
}: {
  prefs: VoicePrefs;
  onChange: (next: VoicePrefs) => void;
  entitlement: EntitlementState;
  compact?: boolean;
}) {
  const premium = entitlement.active;
  const preview = useVoicePreview(prefs);
  const [left, setLeft] = useState(FREE_PREVIEW_SECONDS);
  const stopRef = useRef(preview.stop);
  stopRef.current = preview.stop;

  // Hitung mundur pratinjau untuk pengguna non-premium.
  useEffect(() => {
    if (!preview.running || premium) {
      setLeft(FREE_PREVIEW_SECONDS);
      return;
    }
    const id = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          stopRef.current();
          return FREE_PREVIEW_SECONDS;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [preview.running, premium]);

  const set = (patch: Partial<VoicePrefs>) => onChange({ ...prefs, ...patch });
  const activePreset = useMemo(() => PRESETS.find((p) => p.id === prefs.preset), [prefs.preset]);
  const effectOn = prefs.enabled && prefs.preset !== "off";
  const failed = preview.pipeline.status === "failed" || preview.pipeline.status === "unsupported";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 rounded-2xl border bg-card/60 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="font-semibold">Voice Privacy</p>
            <Badge variant="secondary" className="gap-1">
              <Crown className="size-3" /> Premium
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Ubah warna suara Anda saat panggilan untuk kenyamanan dan privasi. Hanya memproses suara Anda sendiri, tidak
            pernah suara lawan bicara, dan tidak ada rekaman yang disimpan.
          </p>
        </div>
        <Switch
          checked={prefs.enabled}
          onCheckedChange={(v) => set({ enabled: v })}
          aria-label="Aktifkan Voice Privacy"
        />
      </div>

      {!premium && (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
          <p className="font-medium">Pratinjau terbatas</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {entitlement.billingLinked
              ? "Langganan Premium Anda tidak aktif. Efek hanya bisa dicoba lewat pratinjau mikrofon."
              : "Penagihan Premium belum terhubung di ruang kerja ini, jadi efek belum bisa dipakai saat panggilan. Pratinjau mikrofon tetap tersedia."}
          </p>
          <Button asChild size="sm" variant="secondary" className="mt-3">
            <Link to="/premium">Lihat MCM Premium</Link>
          </Button>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preset</p>
        <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
          {PRESETS.map((p) => {
            const active = prefs.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => set({ preset: p.id as PresetId, enabled: p.id === "off" ? false : true })}
                aria-pressed={active}
                className={cn(
                  "rounded-2xl border p-3 text-left transition-colors",
                  active ? "border-primary bg-primary/10" : "bg-card/60 hover:bg-accent/40",
                )}
              >
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{p.desc}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{activePreset?.desc}</p>
      </div>

      {prefs.preset !== "custom" && prefs.preset !== "off" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Intensitas</span>
            <span className="tabular-nums text-muted-foreground">{Math.round(prefs.intensity * 100)}%</span>
          </div>
          <Slider
            value={[prefs.intensity]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={([v]) => set({ intensity: v ?? prefs.intensity })}
            aria-label="Intensitas efek"
          />
        </div>
      )}

      {prefs.preset === "custom" && (
        <div className="space-y-4 rounded-2xl border bg-card/60 p-4">
          {CUSTOM_KEYS.map((key) => {
            const lim = LIMITS[key];
            const meta = PARAM_LABEL[key];
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{meta.label}</span>
                  <span className="tabular-nums text-muted-foreground">{prefs.custom[key]}</span>
                </div>
                <Slider
                  value={[prefs.custom[key]]}
                  min={lim.min}
                  max={lim.max}
                  step={lim.step}
                  onValueChange={([v]) => set({ custom: { ...prefs.custom, [key]: v ?? prefs.custom[key] } })}
                  aria-label={meta.label}
                />
                <p className="text-[11px] text-muted-foreground">{meta.hint}</p>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-3 rounded-2xl border bg-card/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Tes suara</p>
            <p className="text-[11px] text-muted-foreground">
              Gunakan headset agar tidak terjadi feedback. Suara hanya dipantau langsung, tidak direkam.
            </p>
          </div>
          <Button
            size="sm"
            variant={preview.running ? "destructive" : "secondary"}
            onClick={() => (preview.running ? preview.stop() : void preview.start())}
          >
            {preview.running ? <MicOff className="mr-1.5 size-4" /> : <Mic className="mr-1.5 size-4" />}
            {preview.running ? "Berhenti" : "Tes mikrofon"}
          </Button>
        </div>
        {preview.running && (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Level mikrofon">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-100"
                style={{ width: `${Math.round(preview.level * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {preview.pipeline.status === "active"
                ? `Efek berjalan • tambahan latency ±${preview.pipeline.latencyMs} ms`
                : preview.pipeline.reason ?? "Suara normal"}
              {!premium && ` • pratinjau berakhir dalam ${left}s`}
            </p>
          </>
        )}
        {preview.error && <p className="text-[11px] text-destructive">{preview.error}</p>}
        {failed && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {preview.pipeline.reason ?? "Perangkat kembali ke suara normal."}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {effectOn ? "Efek akan aktif pada panggilan berikutnya." : "Efek nonaktif — suara asli Anda yang dikirim."}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => set({ preset: "natural", intensity: 0.7, enabled: false })}
          className="gap-1.5"
        >
          <RotateCcw className="size-3.5" /> Reset
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        MCM sengaja tidak menyediakan kloning suara, unggahan sampel suara orang lain, peniruan individu, maupun mode
        untuk melewati verifikasi suara. Gunakan efek ini hanya untuk privasi dan kenyamanan Anda sendiri.
      </p>
    </div>
  );
}

export function VoiceEffectsSheet({
  open,
  onOpenChange,
  prefs,
  onChange,
  entitlement,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prefs: VoicePrefs;
  onChange: (next: VoicePrefs) => void;
  entitlement: EntitlementState;
  saving?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
        <SheetHeader className="px-0 text-left">
          <SheetTitle className="flex items-center gap-2">
            Efek Suara Premium
            {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </SheetTitle>
          <SheetDescription>Privasi suara real-time untuk panggilan suara dan video.</SheetDescription>
        </SheetHeader>
        <div className="pb-8">
          <VoiceEffectsPanel prefs={prefs} onChange={onChange} entitlement={entitlement} compact />
        </div>
      </SheetContent>
    </Sheet>
  );
}
