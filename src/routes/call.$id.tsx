import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, PhoneMissed, ShieldAlert, Video, Phone as PhoneIcon, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MCMAvatar } from "@/components/mcm/primitives";
import { durasi, tanggalPanjang, jam } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { supabase } from "@/integrations/supabase/client";
import type { CallHistoryItem } from "@/lib/api/calls";
import { VoiceEffectsSheet, VoicePrivacyBadge } from "@/components/mcm/voice-effects";
import { getSettings, updateSettings, voiceOf, type UserSettingsRow } from "@/lib/api/settings";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";
import { DEFAULT_VOICE_PREFS, PRESET_MAP, type VoicePrefs } from "@/lib/voice/presets";

export const Route = createFileRoute("/call/$id")({
  head: () => ({
    meta: [
      { title: "Detail panggilan — MCM" },
      { name: "description", content: "Rincian panggilan MCM: peserta, jenis, status, dan durasi." },
      { property: "og:title", content: "Detail panggilan — MCM" },
      { property: "og:description", content: "Rincian riwayat panggilan MCM." },
    ],
  }),
  component: CallDetailScreen,
});

const STATUS_LABEL: Record<string, string> = {
  ringing: "Berdering",
  ongoing: "Berlangsung",
  ended: "Selesai",
  missed: "Tak terjawab",
  declined: "Ditolak",
  failed: "Gagal",
  unconfigured: "Tidak dikonfigurasi",
};

async function fetchCall(id: string, userId: string): Promise<CallHistoryItem | null> {
  const { data: call, error } = await supabase.from("calls").select("*").eq("id", id).maybeSingle();
  if (error || !call) return null;
  const { data: parts } = await supabase.from("call_participants").select("call_id, user_id").eq("call_id", id);
  const ids = [...new Set((parts ?? []).map((p) => p.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, display_name, avatar_color").in("id", ids.length ? ids : [userId]);
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return {
    ...call,
    participants: (parts ?? []).map((p) => ({
      user_id: p.user_id,
      display_name: pmap.get(p.user_id)?.display_name ?? "Pengguna",
      avatar_color: pmap.get(p.user_id)?.avatar_color ?? "#0ea5e9",
    })),
  };
}

function CallDetailScreen() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallHistoryItem | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [settingsRow, setSettingsRow] = useState<UserSettingsRow | null>(null);
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS);
  const [savingVoice, setSavingVoice] = useState(false);
  const entitlement = useEntitlement(userId, FEATURE_VOICE_EFFECTS);
  // Efek hanya benar-benar dipakai bila entitlement premium aktif; default selalu OFF.
  const voiceActive = entitlement.active && voicePrefs.enabled && voicePrefs.preset !== "off";

  const load = () => {
    if (!userId) return;
    setStatus("loading");
    fetchCall(id, userId)
      .then((c) => {
        setCall(c);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(() => {
    if (!userId) return;
    void getSettings(userId)
      .then((r) => {
        setSettingsRow(r);
        setVoicePrefs(voiceOf(r));
      })
      .catch(() => undefined);
  }, [userId]);

  const saveVoice = (next: VoicePrefs) => {
    setVoicePrefs(next);
    if (!userId) return;
    setSavingVoice(true);
    void updateSettings(userId, { voice: next })
      .then(setSettingsRow)
      .catch(() => undefined)
      .finally(() => setSavingVoice(false));
  };
  void settingsRow;

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId]);

  if (loading || status === "loading") {
    return (
      <div className="app-gradient flex min-h-screen items-center justify-center text-navy-foreground">
        <p className="text-sm">Memuat detail panggilan…</p>
      </div>
    );
  }

  if (status === "error" || !call) {
    return (
      <div className="app-gradient flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center text-navy-foreground">
        <ShieldAlert className="size-10" />
        <p className="text-sm">Data panggilan tidak ditemukan atau gagal dimuat.</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="rounded-xl" onClick={load}>
            Coba lagi
          </Button>
          <Button variant="secondary" className="rounded-xl" onClick={() => void navigate({ to: "/calls" })}>
            Kembali
          </Button>
        </div>
      </div>
    );
  }

  const other = call.participants.find((p) => p.user_id !== userId) ?? call.participants[0] ?? null;
  const isMissed = call.status === "missed";

  return (
    <div className="app-gradient flex min-h-screen flex-col px-6 py-8 text-navy-foreground">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Kembali" className="text-navy-foreground hover:bg-white/15" onClick={() => void navigate({ to: "/calls" })}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold">Detail panggilan</h1>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <MCMAvatar initials={(other?.display_name ?? "MC").slice(0, 2).toUpperCase()} color={other?.avatar_color ?? "from-slate-500 to-slate-700"} size="xl" />
        <h2 className="text-2xl font-semibold">{other?.display_name ?? "Pengguna MCM"}</h2>
        <p className="flex items-center gap-1.5 text-sm text-navy-foreground/70">
          {isMissed && <PhoneMissed className="size-4 text-destructive" />}
          {call.kind === "video" ? <Video className="size-4" /> : <PhoneIcon className="size-4" />}
          {call.kind === "video" ? "Panggilan video" : "Panggilan suara"} • {STATUS_LABEL[call.status] ?? call.status}
        </p>
      </div>

      <div className="mt-8 space-y-3 rounded-2xl bg-white/10 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-navy-foreground/70">Tanggal</span>
          <span className="font-medium">{tanggalPanjang(call.created_at)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-navy-foreground/70">Waktu mulai</span>
          <span className="font-medium">{call.started_at ? jam(call.started_at) : jam(call.created_at)}</span>
        </div>
        {call.ended_at && (
          <div className="flex justify-between">
            <span className="text-navy-foreground/70">Waktu berakhir</span>
            <span className="font-medium">{jam(call.ended_at)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-navy-foreground/70">Durasi</span>
          <span className="font-medium">{durasi(call.duration_sec)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-navy-foreground/70">Peserta</span>
          <span className="max-w-[60%] text-right font-medium">{call.participants.map((p) => p.display_name).join(", ")}</span>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4" /> Efek Suara
            </p>
            <p className="mt-0.5 text-xs text-navy-foreground/70">
              {voiceActive
                ? `Preset ${PRESET_MAP.get(voicePrefs.preset)?.name ?? "Custom"} akan dipakai saat panggilan.`
                : "Nonaktif — suara asli Anda yang dikirim."}
            </p>
          </div>
          <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => setVoiceOpen(true)}>
            Atur
          </Button>
        </div>
        <VoicePrivacyBadge active={voiceActive} className="mt-3" />
      </div>

      <div className="mt-auto space-y-3 pt-8">
        <Button className="w-full rounded-xl" variant="secondary" onClick={() => setNotice(true)}>
          Panggil lagi
        </Button>
        <Button variant="ghost" className="w-full rounded-xl text-navy-foreground/80 hover:bg-white/10" asChild>
          <Link to="/calls">Kembali ke riwayat</Link>
        </Button>
      </div>

      <VoiceEffectsSheet
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        prefs={voicePrefs}
        onChange={saveVoice}
        entitlement={entitlement}
        saving={savingVoice}
      />

      <AlertDialog open={notice} onOpenChange={setNotice}>
        <AlertDialogContent className="max-w-[340px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Panggilan belum dikonfigurasi</AlertDialogTitle>
            <AlertDialogDescription>
              Fitur panggilan suara dan video akan aktif setelah kredensial penyedia panggilan dikonfigurasi oleh admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNotice(false)}>Mengerti</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
