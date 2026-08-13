import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Mic,
  MicOff,
  Phone as PhoneIcon,
  PhoneMissed,
  PhoneOff,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MCMAvatar } from "@/components/mcm/primitives";
import { cn } from "@/lib/utils";
import { durasi, tanggalPanjang, jam } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { supabase } from "@/integrations/supabase/client";
import { CALL_PROVIDER_NOTICE, type CallHistoryItem } from "@/lib/api/calls";
import { useCall } from "@/lib/calls/use-call";
import { VoiceEffectsSheet, VoicePrivacyBadge } from "@/components/mcm/voice-effects";
import { getSettings, updateSettings, voiceOf, type UserSettingsRow } from "@/lib/api/settings";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";
import { DEFAULT_VOICE_PREFS, PRESET_MAP, type VoicePrefs } from "@/lib/voice/presets";

export const Route = createFileRoute("/call/$id")({
  head: () => ({
    meta: [
      { title: "Panggilan — MCM" },
      { name: "description", content: "Layar panggilan suara dan video MCM dengan efek suara privasi premium." },
      { property: "og:title", content: "Panggilan — MCM" },
      { property: "og:description", content: "Panggilan suara & video privat MCM." },
    ],
  }),
  component: CallScreen,
});

const STATUS_LABEL: Record<string, string> = {
  ringing: "Berdering",
  ongoing: "Berlangsung",
  ended: "Selesai",
  missed: "Tak terjawab",
  declined: "Ditolak",
  failed: "Gagal",
  unconfigured: "Belum terhubung",
};

async function fetchCall(id: string, userId: string): Promise<CallHistoryItem | null> {
  const { data: call, error } = await supabase.from("calls").select("*").eq("id", id).maybeSingle();
  if (error || !call) return null;
  const { data: parts } = await supabase.from("call_participants").select("call_id, user_id").eq("call_id", id);
  const ids = [...new Set((parts ?? []).map((p) => p.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_color, avatar_url, avatar_version")
    .in("id", ids.length ? ids : [userId]);
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]));
  return {
    ...call,
    participants: (parts ?? []).map((p) => ({
      user_id: p.user_id,
      display_name: pmap.get(p.user_id)?.display_name ?? "Pengguna",
      avatar_color: pmap.get(p.user_id)?.avatar_color ?? "#0ea5e9",
      avatar_url: pmap.get(p.user_id)?.avatar_url ?? null,
      avatar_version: pmap.get(p.user_id)?.avatar_version ?? 0,
    })),
  };
}

function CallScreen() {
  const { id } = Route.useParams();
  const { userId, loading } = useRequireAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CallHistoryItem | null>(null);
  const [detailStatus, setDetailStatus] = useState<"loading" | "ready" | "error">("loading");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [, setSettingsRow] = useState<UserSettingsRow | null>(null);
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS);
  const [savingVoice, setSavingVoice] = useState(false);
  const entitlement = useEntitlement(userId, FEATURE_VOICE_EFFECTS);
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);

  const session = useCall({ callId: id, userId, prefs: voicePrefs, premium: entitlement.active });

  const load = () => {
    if (!userId) return;
    setDetailStatus("loading");
    fetchCall(id, userId)
      .then((c) => {
        setDetail(c);
        setDetailStatus("ready");
      })
      .catch(() => setDetailStatus("error"));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId, session.phase]);

  useEffect(() => {
    if (!userId) return;
    void getSettings(userId)
      .then((r) => {
        setSettingsRow(r);
        setVoicePrefs(voiceOf(r));
      })
      .catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    session.attachLocalVideo(localVideo.current);
    session.attachRemoteVideo(remoteVideo.current);
  }, [session, session.remotes.length, session.controls.cameraOn]);

  const saveVoice = (next: VoicePrefs) => {
    setVoicePrefs(next);
    if (!userId) return;
    setSavingVoice(true);
    void updateSettings(userId, { voice: next })
      .then(setSettingsRow)
      .catch(() => undefined)
      .finally(() => setSavingVoice(false));
  };

  if (loading || detailStatus === "loading") {
    return (
      <div className="app-gradient flex min-h-screen items-center justify-center text-navy-foreground">
        <p className="text-sm">Memuat panggilan…</p>
      </div>
    );
  }

  if (detailStatus === "error" || !detail) {
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

  const other = detail.participants.find((p) => p.user_id !== userId) ?? detail.participants[0] ?? null;
  const name = other?.display_name ?? "Pengguna MCM";
  const initials = name.slice(0, 2).toUpperCase();
  const isVideo = detail.kind === "video";
  const live = session.phase === "outgoing" || session.phase === "incoming" || session.phase === "connecting" || session.phase === "connected";
  const voiceActive = session.voiceApplied;
  const voiceFallback = session.voiceFallback;

  const phaseLabel =
    session.phase === "connected"
      ? durasi(session.durationSec)
      : session.phase === "connecting"
        ? "Menyambungkan…"
        : session.phase === "outgoing"
          ? "Memanggil…"
          : session.phase === "incoming"
            ? `${isVideo ? "Panggilan video" : "Panggilan suara"} masuk`
            : (STATUS_LABEL[detail.status] ?? detail.status);

  if (live) {
    return (
      <div className="app-gradient relative flex min-h-screen flex-col px-6 py-8 text-navy-foreground">
        {isVideo && (
          <>
            <video ref={remoteVideo} autoPlay playsInline className="absolute inset-0 size-full object-cover opacity-90" />
            <video
              ref={localVideo}
              autoPlay
              playsInline
              muted
              className="absolute top-20 right-4 z-10 h-40 w-28 rounded-2xl border border-white/25 object-cover"
            />
          </>
        )}

        <div className="relative z-10 flex flex-1 flex-col">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Kembali"
              className="text-navy-foreground hover:bg-white/15"
              onClick={() => void navigate({ to: "/calls" })}
            >
              <ArrowLeft className="size-5" />
            </Button>
            <h1 className="text-base font-semibold">{isVideo ? "Panggilan video" : "Panggilan suara"}</h1>
          </div>

          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            {!isVideo && other && (
              <UserAvatar
                userId={other.user_id}
                path={other.avatar_url}
                version={other.avatar_version}
                name={other.display_name}
                color={other.avatar_color}
                size="xl"
              />
            )}
            {!isVideo && !other && <MCMAvatar initials={initials} color="from-slate-500 to-slate-700" size="xl" />}
            <h2 className="text-2xl font-semibold">{name}</h2>
            <p className="text-sm text-navy-foreground/75">{phaseLabel}</p>
            {session.reason && <p className="text-xs text-navy-foreground/60">{session.reason}</p>}
            <VoicePrivacyBadge active={voiceActive} className="mt-1" />
            {voiceFallback ? (
              <p className="mt-1 text-xs text-navy-foreground/70">
                Voice Privacy tidak tersedia di perangkat ini — panggilan berlanjut dengan mikrofon apa adanya.
              </p>
            ) : null}
            {session.pipelineState.reason && (
              <p className="text-[11px] text-navy-foreground/60">{session.pipelineState.reason}</p>
            )}
          </div>

          <div className="mt-auto space-y-6 pt-10">
            <div className="flex justify-center">
              <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => setVoiceOpen(true)}>
                <Sparkles className="mr-1.5 size-4" />
                Efek Suara
              </Button>
            </div>

            {session.phase === "incoming" ? (
              <div className="flex items-center justify-center gap-10">
                <div className="flex flex-col items-center gap-1.5">
                  <Button
                    size="icon"
                    className="size-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    aria-label="Tolak panggilan"
                    onClick={session.decline}
                  >
                    <PhoneOff className="size-7" />
                  </Button>
                  <span className="text-[10px] text-white/70">Tolak</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <Button
                    size="icon"
                    className="size-16 rounded-full bg-success text-success-foreground hover:bg-success/90"
                    aria-label="Jawab panggilan"
                    onClick={session.answer}
                  >
                    <PhoneIcon className="size-7" />
                  </Button>
                  <span className="text-[10px] text-white/70">Jawab</span>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-4 justify-items-center gap-3">
                  <ControlButton
                    label={session.controls.muted ? "Suara mati" : "Mikrofon"}
                    active={session.controls.muted}
                    ariaLabel="Bisukan mikrofon"
                    onClick={session.toggleMute}
                    icon={session.controls.muted ? MicOff : Mic}
                  />
                  <ControlButton
                    label="Kamera"
                    active={!session.controls.cameraOn}
                    disabled={!isVideo}
                    ariaLabel="Nyalakan kamera"
                    onClick={session.toggleCamera}
                    icon={session.controls.cameraOn ? Video : VideoOff}
                  />
                  {/* Tombol speaker hanya muncul bila rute keluaran memang bisa
                      diatur; kalau tidak, label jujur "Diatur sistem". */}
                  {session.speakerSupported ? (
                    <ControlButton
                      label="Speaker"
                      active={session.controls.speakerOn}
                      ariaLabel="Pengeras suara"
                      onClick={session.toggleSpeaker}
                      icon={session.controls.speakerOn ? Volume2 : VolumeX}
                    />
                  ) : (
                    <ControlButton
                      label="Diatur sistem"
                      active={false}
                      disabled
                      ariaLabel="Keluaran audio diatur sistem"
                      onClick={() => undefined}
                      icon={Volume2}
                    />
                  )}
                  <ControlButton
                    label="Balik kamera"
                    active={false}
                    disabled={!isVideo}
                    ariaLabel="Balik kamera"
                    onClick={session.switchCamera}
                    icon={RefreshCcw}
                  />
                </div>
                <div className="flex justify-center">
                  <Button
                    size="icon"
                    className="size-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    aria-label="Akhiri panggilan"
                    onClick={() => session.hangup()}
                  >
                    <PhoneOff className="size-7" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <VoiceEffectsSheet
          open={voiceOpen}
          onOpenChange={setVoiceOpen}
          prefs={voicePrefs}
          onChange={saveVoice}
          entitlement={entitlement}
          saving={savingVoice}
        />
      </div>
    );
  }

  return (
    <div className="app-gradient flex min-h-screen flex-col px-6 py-8 text-navy-foreground">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kembali"
          className="text-navy-foreground hover:bg-white/15"
          onClick={() => void navigate({ to: "/calls" })}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold">Detail panggilan</h1>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        {other ? (
          <UserAvatar
            userId={other.user_id}
            path={other.avatar_url}
            version={other.avatar_version}
            name={other.display_name}
            color={other.avatar_color}
            size="xl"
          />
        ) : (
          <MCMAvatar initials={initials} color="from-slate-500 to-slate-700" size="xl" />
        )}
        <h2 className="text-2xl font-semibold">{name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-navy-foreground/70">
          {detail.status === "missed" && <PhoneMissed className="size-4 text-destructive" />}
          {isVideo ? <Video className="size-4" /> : <PhoneIcon className="size-4" />}
          {isVideo ? "Panggilan video" : "Panggilan suara"} • {STATUS_LABEL[detail.status] ?? detail.status}
        </p>
      </div>

      {session.phase === "unconfigured" && (
        <div className="mt-6 rounded-2xl border border-amber-300/40 bg-amber-400/15 p-4 text-sm">
          <p className="font-semibold">Belum terhubung</p>
          <p className="mt-1 text-navy-foreground/80">
            {CALL_PROVIDER_NOTICE} Admin perlu mengisi kredensial LiveKit (URL, API key, API secret) agar media panggilan aktif.
          </p>
        </div>
      )}

      {session.phase === "error" && session.reason && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/15 p-4 text-sm">{session.reason}</div>
      )}

      <div className="mt-6 space-y-3 rounded-2xl bg-white/10 p-4 text-sm">
        <Row label="Tanggal" value={tanggalPanjang(detail.created_at)} />
        <Row label="Waktu mulai" value={jam(detail.started_at ?? detail.created_at)} />
        {detail.ended_at && <Row label="Waktu berakhir" value={jam(detail.ended_at)} />}
        <Row label="Durasi" value={durasi(detail.duration_sec)} />
        <Row label="Peserta" value={detail.participants.map((p) => p.display_name).join(", ")} />
      </div>

      <div className="mt-6 rounded-2xl bg-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4" /> Efek Suara
            </p>
            <p className="mt-0.5 text-xs text-navy-foreground/70">
              {entitlement.active && voicePrefs.enabled && voicePrefs.preset !== "off"
                ? `Preset ${PRESET_MAP.get(voicePrefs.preset)?.name ?? "Custom"} akan dipakai saat panggilan.`
                : "Nonaktif — suara asli Anda yang dikirim."}
            </p>
          </div>
          <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => setVoiceOpen(true)}>
            Atur
          </Button>
        </div>
        <VoicePrivacyBadge active={entitlement.active && voicePrefs.enabled && voicePrefs.preset !== "off"} className="mt-3" />
      </div>

      <div className="mt-auto space-y-3 pt-8">
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
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-navy-foreground/70">{label}</span>
      <span className="max-w-[60%] text-right font-medium">{value}</span>
    </div>
  );
}

function ControlButton({
  label,
  ariaLabel,
  active,
  disabled,
  onClick,
  icon: Icon,
}: {
  label: string;
  ariaLabel: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: typeof Mic;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        size="icon"
        disabled={disabled ?? false}
        aria-label={ariaLabel}
        onClick={onClick}
        className={cn(
          "size-14 rounded-full border border-white/20",
          active ? "bg-white text-navy hover:bg-white/90" : "bg-white/15 text-white hover:bg-white/25",
        )}
      >
        <Icon className="size-6" />
      </Button>
      <span className="text-[10px] text-white/70">{label}</span>
    </div>
  );
}
