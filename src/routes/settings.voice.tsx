import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { VoiceEffectsPanel } from "@/components/mcm/voice-effects";
import { useAuth } from "@/lib/auth";
import { voiceOf } from "@/lib/api/settings";
import { useUserSettings } from "@/lib/settings/use-settings";
import { Button } from "@/components/ui/button";
import { changedVoicePrefs } from "@/lib/voice/settings-patch";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";
import { type VoicePrefs } from "@/lib/voice/presets";

export const Route = createFileRoute("/settings/voice")({
  head: () => ({
    meta: [
      { title: "Efek Suara Premium — Panggilan TOKOLINK" },
      {
        name: "description",
        content:
          "Pilih preset Voice Privacy default, atur nada dan peredam derau, lalu tes mikrofon sebelum menelepon.",
      },
      { property: "og:title", content: "Efek Suara Premium — Panggilan TOKOLINK" },
      {
        property: "og:description",
        content: "Preset default Voice Privacy dan tes mikrofon untuk panggilan TOKOLINK.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoiceSettingsPage,
});

function VoiceSettingsPage() {
  const { user } = useAuth();
  return <VoiceSettingsAccount key={user?.id ?? "signed-out"} userId={user?.id} />;
}

function VoiceSettingsAccount({ userId }: { userId: string | undefined }) {
  const ent = useEntitlement(userId, FEATURE_VOICE_EFFECTS);
  const { settings, loading, error, saving, refresh, patch } = useUserSettings(userId);
  const [draft, setDraft] = useState<{ base: VoicePrefs; prefs: VoicePrefs } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saved = voiceOf(settings);
  const prefs = draft?.prefs ?? saved;
  const changes = changedVoicePrefs(draft?.base ?? saved, prefs);
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (!dirty || saving) return;
    setSaveError(null);
    try {
      await patch({ voice: changes });
      setDraft(null);
      toast.success("Preferensi suara tersimpan");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Gagal menyimpan preferensi suara");
    }
  };

  return (
    <AppShell
      header={
        <MobileHeader
          title="Efek Suara Premium"
          subtitle={saving ? "Menyimpan…" : "Preferensi panggilan"}
          back
        />
      }
    >
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4 pb-24">
        {loading && !settings ? <p role="status">Memuat preferensi suara…</p> : null}
        {error ? (
          <div role="alert" className="space-y-2 rounded-2xl border border-destructive/30 p-4">
            <p className="text-sm">{error}</p>
            <Button variant="outline" onClick={() => void refresh()}>
              Coba lagi
            </Button>
          </div>
        ) : null}
        {!userId ? <p role="status">Masuk untuk mengatur preferensi suara.</p> : null}
        {settings ? (
          <>
            <fieldset disabled={saving || Boolean(error)} className="min-w-0 disabled:opacity-60">
              <legend className="sr-only">Preferensi efek suara</legend>
              <VoiceEffectsPanel
                prefs={prefs}
                onChange={(next) =>
                  setDraft((current) => ({ base: current?.base ?? saved, prefs: next }))
                }
                entitlement={ent}
              />
            </fieldset>
            <div className="space-y-3 rounded-2xl border bg-card p-4">
              <p className="text-xs text-muted-foreground" role="status">
                {dirty
                  ? "Ada perubahan yang belum disimpan."
                  : "Preferensi tersimpan di akun Anda."}{" "}
                Penerapan saat panggilan bergantung pada langganan dan dukungan perangkat.
              </p>
              {saveError ? (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!dirty || saving || Boolean(error)} onClick={() => void save()}>
                  {saving ? "Menyimpan…" : "Simpan preferensi"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!dirty || saving}
                  onClick={() => {
                    setDraft(null);
                    setSaveError(null);
                  }}
                >
                  Batalkan perubahan
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
