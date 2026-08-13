import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { VoiceEffectsPanel } from "@/components/mcm/voice-effects";
import { useAuth } from "@/lib/auth";
import { getSettings, updateSettings, voiceOf, type UserSettingsRow } from "@/lib/api/settings";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from "@/lib/voice/presets";

export const Route = createFileRoute("/settings/voice")({
  head: () => ({
    meta: [
      { title: "Efek Suara Premium — Panggilan MCM" },
      {
        name: "description",
        content:
          "Pilih preset Voice Privacy default, atur nada dan peredam derau, lalu tes mikrofon sebelum menelepon.",
      },
      { property: "og:title", content: "Efek Suara Premium — Panggilan MCM" },
      {
        property: "og:description",
        content: "Preset default Voice Privacy dan tes mikrofon untuk panggilan MCM.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoiceSettingsPage,
});

function VoiceSettingsPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const ent = useEntitlement(userId, FEATURE_VOICE_EFFECTS);
  const [row, setRow] = useState<UserSettingsRow | null>(null);
  const [prefs, setPrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    void getSettings(userId)
      .then((r) => {
        setRow(r);
        setPrefs(voiceOf(r));
      })
      .catch(() => undefined);
  }, [userId]);

  // Simpan hanya preferensi (angka & nama preset) — tidak ada data suara.
  useEffect(() => {
    if (!userId || !row) return;
    const saved = voiceOf(row);
    if (JSON.stringify(saved) === JSON.stringify(prefs)) return;
    const id = window.setTimeout(() => {
      setSaving(true);
      void updateSettings(userId, { voice: prefs })
        .then((next) => setRow(next))
        .catch(() => toast.error("Gagal menyimpan preferensi suara"))
        .finally(() => setSaving(false));
    }, 500);
    return () => window.clearTimeout(id);
  }, [prefs, userId, row]);

  return (
    <AppShell
      header={
        <MobileHeader
          title="Efek Suara Premium"
          subtitle={saving ? "Menyimpan…" : "Panggilan"}
          back
        />
      }
    >
      <div className="p-4">
        <VoiceEffectsPanel prefs={prefs} onChange={setPrefs} entitlement={ent} />
      </div>
    </AppShell>
  );
}
