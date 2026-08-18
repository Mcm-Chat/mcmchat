import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CallStatusLive } from "@/components/mcm/call-status-live";
import { CallConnectionBadge } from "@/components/mcm/call-connection-badge";
import { CallProviderStatus } from "@/components/mcm/call-provider-status";
import { CallQualityMetrics } from "@/components/mcm/call-quality-metrics";
import { useProviderHealth } from "@/lib/calls/use-provider-health";
import { CallDurationLive } from "@/components/mcm/call-duration-live";
import { setCallReturnFocus } from "@/lib/calls/return-focus";
import {
  clearLastCallState,
  loadLastCallState,
  saveLastCallState,
  type LastCallPhase,
  type RecoveryTarget,
} from "@/lib/calls/last-call-state";
import { playTone, playEndTone } from "@/lib/calls/tones";
import {
  ArrowLeft,
  Mic,
  MicOff,
  Phone as PhoneIcon,
  PhoneMissed,
  PhoneOff,
  RefreshCcw,
  ShieldAlert,
  SlidersHorizontal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Sparkles,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MCMAvatar } from "@/components/mcm/primitives";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { cn } from "@/lib/utils";
import { durasi, tanggalPanjang, jam } from "@/lib/mcm/format";
import { useRequireAuth } from "@/lib/api/guard";
import { fetchProfileCards } from "@/lib/api/profiles";
import { supabase } from "@/integrations/supabase/client";
import { CALL_PROVIDER_NOTICE, type CallHistoryItem } from "@/lib/api/calls";
import { toast } from "sonner";
import { useCall } from "@/lib/calls/use-call";
import { VoiceEffectsSheet, VoicePrivacyBadge } from "@/components/mcm/voice-effects";
import { CallDeviceSheet } from "@/components/mcm/call-device-sheet";
import { CallFailureRecovery } from "@/components/mcm/call-failure-recovery";
import { CallShortcutsHelp } from "@/components/mcm/call-shortcuts-help";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CallPermissionGate } from "@/components/mcm/call-permission-gate";
import { CallPermissionStatus } from "@/components/mcm/call-permission-status";
import { useMediaPermission } from "@/lib/calls/use-media-permission";
import { useCallShortcuts, type CallShortcutAction } from "@/lib/calls/use-call-shortcuts";
import { getSettings, updateSettings, voiceOf, type UserSettingsRow } from "@/lib/api/settings";
import { FEATURE_VOICE_EFFECTS, useEntitlement } from "@/lib/api/entitlements";
import { DEFAULT_VOICE_PREFS, PRESET_MAP, type VoicePrefs } from "@/lib/voice/presets";
import { CallSkeleton } from "@/components/mcm/route-skeletons";

export const Route = createFileRoute("/call/$id")({
  head: () => ({
    meta: [
      { title: "Panggilan — MCM" },
      {
        name: "description",
        content: "Layar panggilan suara dan video MCM dengan efek suara privasi premium.",
      },
      { property: "og:title", content: "Panggilan — MCM" },
      { property: "og:description", content: "Panggilan suara & video privat MCM." },
    ],
  }),
  component: CallScreen,
  pendingComponent: () => <CallSkeleton />,
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
  const { data: parts } = await supabase
    .from("call_participants")
    .select("call_id, user_id")
    .eq("call_id", id);
  const ids = [...new Set((parts ?? []).map((p) => p.user_id))];
  const pmap = await fetchProfileCards(ids.length ? ids : [userId]);
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
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [, setSettingsRow] = useState<UserSettingsRow | null>(null);
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(DEFAULT_VOICE_PREFS);
  const [savingVoice, setSavingVoice] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const providerHealth = useProviderHealth();
  /** Status panggilan tersimpan (dipulihkan sekali setelah refresh/pindah halaman). */
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState<ReturnType<typeof loadLastCallState>>(null);
  const answerRef = useRef<HTMLButtonElement | null>(null);
  const hangupRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const entitlement = useEntitlement(userId, FEATURE_VOICE_EFFECTS);
  const session = useCall({ callId: id, userId, prefs: voicePrefs, premium: entitlement.active });

  // Izin mikrofon (dan kamera untuk panggilan video) diperiksa selama panggilan
  // masuk berdering; tombol "Jawab" baru aktif setelah izin benar-benar ada.
  const permission = useMediaPermission(
    detail?.kind === "video" ? "video" : "audio",
    session.phase !== "ended",
  );
  const answerBlocked = session.phase === "incoming" && !permission.ready;
  const answerWithPermission = () => {
    if (permission.ready) {
      session.answer();
      return;
    }
    void permission.request().then((next) => {
      if (next === "granted" || next === "audio_only") session.answer();
    });
  };

  // Pulihkan status terakhir supaya UI tidak kembali ke state yang salah
  // (mis. panel gagal hilang) setelah refresh atau pindah halaman.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = loadLastCallState(id);
    if (!saved) return;
    setRestored(saved);
    if (saved.phase === "error" || saved.phase === "unconfigured")
      setErrorDismissed(saved.dismissed);
  }, [id]);

  // Simpan status + target pemulihan setiap kali fase/alasan berubah.
  useEffect(() => {
    const phase = session.phase;
    if (phase === "loading") return;
    if (phase === "error" || phase === "unconfigured") {
      const recovery: RecoveryTarget = errorDismissed ? "back" : "retry";
      saveLastCallState({
        callId: id,
        phase,
        reason: session.reason,
        dismissed: errorDismissed,
        recovery,
      });
      return;
    }
    if (phase === "ended") {
      clearLastCallState();
      return;
    }
    saveLastCallState({
      callId: id,
      phase: phase as LastCallPhase,
      reason: session.reason,
      dismissed: false,
      recovery: "back",
    });
  }, [id, session.phase, session.reason, errorDismissed]);

  // Pintasan keyboard kontrol panggilan (M/V/S/B/P/E/A/T dan "?" untuk bantuan).
  const shortcutsLive =
    session.phase === "outgoing" ||
    session.phase === "incoming" ||
    session.phase === "connecting" ||
    session.phase === "connected";
  const videoCall = detail?.kind === "video";
  const shortcuts = useCallShortcuts({
    enabled: shortcutsLive,
    onAction: (action: CallShortcutAction) => {
      const incoming = session.phase === "incoming";
      switch (action) {
        case "mute":
          if (incoming) return;
          session.toggleMute();
          shortcuts.announce(session.controls.muted ? "Mikrofon dinyalakan" : "Mikrofon dibisukan");
          return;
        case "camera":
          if (incoming || !videoCall) return;
          session.toggleCamera();
          shortcuts.announce(session.controls.cameraOn ? "Kamera dimatikan" : "Kamera dinyalakan");
          return;
        case "speaker":
          if (incoming || !session.speakerSupported) return;
          session.toggleSpeaker();
          shortcuts.announce(
            session.controls.speakerOn ? "Pengeras suara dimatikan" : "Pengeras suara dinyalakan",
          );
          return;
        case "switchCamera":
          if (incoming || !videoCall) return;
          session.switchCamera();
          shortcuts.announce("Kamera dibalik");
          return;
        case "devices":
          if (incoming) return;
          session.refreshDevices();
          setDevicesOpen(true);
          shortcuts.announce("Pemilih perangkat dibuka");
          return;
        case "hangup":
          if (incoming) return;
          session.hangup();
          shortcuts.announce("Panggilan diakhiri");
          return;
        case "answer":
          if (!incoming) return;
          if (!permission.ready) {
            shortcuts.announce(permission.copy.title);
            answerWithPermission();
            return;
          }
          session.answer();
          shortcuts.announce("Panggilan dijawab");
          return;
        case "decline":
          if (!incoming) return;
          session.decline();
          shortcuts.announce("Panggilan ditolak");
          return;
      }
    },
  });

  // Nada tunggu (pemanggil) / nada dering (penerima) selama panggilan belum
  // dijawab, lalu nada singkat saat panggilan berakhir.
  useEffect(() => {
    if (session.phase !== "outgoing" && session.phase !== "incoming") return;
    const handle = playTone(session.phase === "outgoing" ? "ringback" : "ringtone");
    return () => handle.stop();
  }, [session.phase]);

  useEffect(() => {
    if (session.phase === "ended") playEndTone();
  }, [session.phase]);

  // Kegagalan baru selalu memunculkan panel pemulihan lagi, walau panel
  // sebelumnya sempat ditutup pengguna.
  useEffect(() => {
    if (session.phase === "error" || session.phase === "unconfigured") setErrorDismissed(false);
  }, [session.phase, session.reason]);

  // Fokus keyboard mengikuti fase panggilan: saat panggilan masuk fokus ke
  // "Jawab", setelah diterima ke "Akhiri panggilan", dan setelah ditolak/
  // berakhir ke tombol "Kembali" agar fokus tidak pernah hilang ke <body>.
  useEffect(() => {
    const target =
      session.phase === "incoming"
        ? answerRef
        : session.phase === "connected" || session.phase === "connecting"
          ? hangupRef
          : session.phase === "ended"
            ? backRef
            : (session.phase === "error" || session.phase === "unconfigured") && errorDismissed
              ? // panel pemulihan sudah ditutup: fokus jangan jatuh ke <body>
                backRef
              : null; // fase gagal dengan panel terbuka difokuskan panel pemulihan
    if (!target) return;
    const raf = requestAnimationFrame(() => target.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [session.phase, errorDismissed]);

  /** Kembali ke riwayat sambil menandai tombol panggilan mana yang harus difokuskan. */
  const backToCalls = () => {
    setCallReturnFocus(id);
    void navigate({ to: "/calls" });
  };

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

  // Detail (peserta, durasi tersimpan) hanya perlu dimuat ulang saat panggilan
  // benar-benar berakhir — bukan setiap perubahan fase/render.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId, session.phase === "ended"]);

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

  if (loading || detailStatus === "loading") {
    return (
      <div
        data-call-surface=""
        className="app-gradient flex min-h-dvh items-center justify-center px-6 py-[max(1.5rem,env(safe-area-inset-bottom))] text-navy-foreground"
      >
        <p className="text-sm">Memuat panggilan…</p>
      </div>
    );
  }

  if (detailStatus === "error" || !detail) {
    return (
      <div
        data-call-surface=""
        className="app-gradient flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-navy-foreground"
      >
        <ShieldAlert className="size-10" />
        <p className="text-sm">Data panggilan tidak ditemukan atau gagal dimuat.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" className="min-h-11 rounded-xl px-5" onClick={load}>
            Coba lagi
          </Button>
          <Button variant="secondary" className="min-h-11 rounded-xl px-5" onClick={backToCalls}>
            Kembali
          </Button>
        </div>
      </div>
    );
  }

  const other =
    detail.participants.find((p) => p.user_id !== userId) ?? detail.participants[0] ?? null;
  const name = other?.display_name ?? "Pengguna MCM";
  const initials = name.slice(0, 2).toUpperCase();
  const isVideo = detail.kind === "video";
  const live =
    session.phase === "outgoing" ||
    session.phase === "incoming" ||
    session.phase === "connecting" ||
    session.phase === "connected";
  const voiceActive = session.voiceApplied;
  // Setelah refresh, sesi tidak lagi tahu panggilan sempat gagal. Status
  // tersimpan dipakai agar panel pemulihan tetap muncul (bukan layar netral).
  const restoredFailure =
    !live &&
    session.phase !== "error" &&
    session.phase !== "unconfigured" &&
    (restored?.phase === "error" || restored?.phase === "unconfigured");
  const voiceFallback = session.voiceFallback;

  // Kontrol perangkat hanya aktif kalau izinnya benar-benar ada. Tooltip
  // memakai kalimat yang sama di semua tombol supaya tidak membingungkan.
  const micGranted = permission.state === "granted" || permission.state === "audio_only";
  const cameraGranted = isVideo && permission.state === "granted" && !session.cameraBlocked;
  const micHint = permission.requesting
    ? "Sedang meminta izin mikrofon…"
    : permission.state === "checking"
      ? "Memeriksa izin mikrofon…"
      : "Izin mikrofon belum diberikan. Izinkan mikrofon di pengaturan browser/perangkat.";
  const cameraHint = !isVideo
    ? "Panggilan suara tidak memakai kamera."
    : session.cameraBlocked || permission.state === "audio_only"
      ? "Izin kamera ditolak. Panggilan berjalan sebagai suara saja."
      : permission.state === "checking"
        ? "Memeriksa izin kamera…"
        : "Izin kamera belum diberikan. Izinkan kamera di pengaturan browser/perangkat.";

  // Tombol tidak pernah dimatikan total: kalau izin belum ada, sentuhan
  // pertama memicu permintaan izin, lalu aksinya langsung dijalankan.
  const withPermission =
    (granted: boolean, hint: string, run: () => void, needCamera = false) =>
    () => {
      if (granted) {
        run();
        return;
      }
      if (permission.requesting) return;
      void permission.request().then((next) => {
        const ok = needCamera ? next === "granted" : next === "granted" || next === "audio_only";
        if (ok) run();
        else toast.error(hint);
      });
    };

  // Sebelum panggilan tersambung tidak ada sesi media sama sekali: kontrol
  // mikrofon/kamera/speaker/perangkat tidak punya apa pun untuk diubah.
  // Ditampilkan nonaktif dengan alasan jujur, bukan tombol mati diam-diam.
  const callOver =
    session.phase === "ended" || session.phase === "error" || session.phase === "unconfigured";
  // Aktif hanya ketika sesi media benar-benar hidup; mati lagi begitu
  // panggilan berakhir/gagal.
  const controlsLive = session.phase === "connected" && !callOver;
  const notLiveHint = callOver
    ? "Panggilan sudah berakhir"
    : session.phase === "connecting"
      ? "Menyambungkan… tombol aktif setelah tersambung"
      : "Aktif setelah panggilan tersambung";

  // Tutup sheet perangkat begitu panggilan berakhir supaya tidak ada kontrol
  // yang tampak masih bisa dipakai.
  useEffect(() => {
    if (callOver) setDevicesOpen(false);
  }, [callOver]);

  // Feedback instan tiap tombol ditekan: aksi dijalankan dulu, lalu toast
  // menyebut keadaan barunya (bukan janji, tapi hasil toggle).
  const withFeedback = (run: () => void, message: () => string) => () => {
    run();
    toast.success(message(), { duration: 1600 });
  };

  const phaseLabel =
    session.phase === "connected"
      ? // Durasi hanya ditampilkan bila server panggilan terhubung dan media
        // benar-benar mulai; kalau tidak, layar jujur menyebut tahapannya.
        providerHealth.health === "offline"
        ? "Server panggilan terputus"
        : session.mediaLive
          ? durasi(session.durationSec)
          : "Menyiapkan media…"
      : session.phase === "connecting"
        ? "Menyambungkan…"
        : session.phase === "outgoing"
          ? "Memanggil…"
          : session.phase === "incoming"
            ? `${isVideo ? "Panggilan video" : "Panggilan suara"} masuk`
            : (STATUS_LABEL[detail.status] ?? detail.status);

  if (live) {
    return (
      <div
        data-call-surface=""
        className="app-gradient relative flex min-h-dvh flex-col px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-navy-foreground"
      >
        {isVideo && (
          <>
            <video
              ref={session.attachRemoteVideo}
              autoPlay
              playsInline
              className="absolute inset-0 size-full object-cover opacity-90"
            />
            <video
              ref={session.attachLocalVideo}
              autoPlay
              playsInline
              muted
              className="absolute top-[calc(env(safe-area-inset-top)+5rem)] right-4 z-10 h-36 w-24 sm:h-40 sm:w-28 rounded-2xl border border-on-dark-border object-cover"
            />
          </>
        )}

        <div className="relative z-10 flex flex-1 flex-col">
          <CallStatusLive
            phase={session.phase}
            kind={isVideo ? "video" : "audio"}
            name={name}
            reason={session.reason}
            endStatus={detail.status}
            durationSec={detail.duration_sec}
            retrying={session.retrying}
            quality={session.quality}
            audioBlocked={session.audioBlocked}
          />
          <CallDurationLive
            active={session.phase === "connected"}
            durationSec={session.durationSec}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Kembali"
              className="size-11 text-navy-foreground hover:bg-on-dark-surface"
              onClick={backToCalls}
            >
              <ArrowLeft className="size-5" />
            </Button>
            <h1 className="text-base font-semibold">
              {isVideo ? "Panggilan video" : "Panggilan suara"}
            </h1>
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
            {!isVideo && !other && (
              <MCMAvatar initials={initials} color="from-navy to-primary" size="xl" />
            )}
            <h2 className="text-2xl font-semibold">{name}</h2>
            <div className="flex items-center gap-2 text-sm text-navy-foreground/75">
              <span>{phaseLabel}</span>
              {session.phase === "connected" && <SignalBadge quality={session.quality} />}
            </div>
            <CallConnectionBadge
              phase={session.phase}
              retrying={session.retrying}
              stalled={session.connectStalled}
              quality={session.quality}
              audioBlocked={session.audioBlocked}
              permission={permission.state}
              providerHealth={providerHealth.health}
              mediaLive={session.mediaLive}
              className="mt-1"
            />
            <CallProviderStatus status={providerHealth} className="mt-1" />
            {session.phase !== "incoming" && permission.state !== "granted" ? (
              <CallPermissionStatus permission={permission} className="mt-2 w-full text-left" />
            ) : null}
            {session.phase === "connected" && (
              <CallQualityMetrics metrics={session.metrics} className="mt-2" />
            )}
            {session.reason && <p className="text-xs text-navy-foreground/60">{session.reason}</p>}
            {session.connectStalled && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 rounded-xl"
                disabled={session.retrying}
                onClick={session.retry}
              >
                {session.retrying ? "Menyambungkan…" : "Coba lagi"}
              </Button>
            )}
            <VoicePrivacyBadge active={voiceActive} className="mt-1" />
            {voiceFallback ? (
              <p className="mt-1 text-xs text-navy-foreground/70">
                Voice Privacy tidak tersedia di perangkat ini — panggilan berlanjut dengan mikrofon
                apa adanya.
              </p>
            ) : null}
            {session.pipelineState.reason && (
              <p className="text-[11px] text-navy-foreground/60">{session.pipelineState.reason}</p>
            )}
            {session.audioBlocked && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 rounded-xl"
                onClick={session.enableAudio}
              >
                Aktifkan suara
              </Button>
            )}
          </div>

          <div className="mt-auto space-y-6 pt-10">
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="secondary"
                className="rounded-xl"
                onClick={() => setVoiceOpen(true)}
              >
                <Sparkles className="mr-1.5 size-4" />
                Efek Suara
              </Button>
            </div>

            <CallShortcutsHelp
              open={shortcuts.helpOpen}
              onToggle={() => shortcuts.setHelpOpen(!shortcuts.helpOpen)}
              announcement={shortcuts.announcement}
            />

            {session.phase === "incoming" ? (
              <>
                <CallPermissionGate permission={permission} onDecline={session.decline} />
                <div className="flex items-center justify-center gap-10">
                  {/* Jawab lebih dulu di DOM (urutan Tab), tetap di kanan secara visual. */}
                  <div className="order-2 flex flex-col items-center gap-1.5">
                    <Button
                      ref={answerRef}
                      size="icon"
                      className="size-16 rounded-full bg-success text-success-foreground hover:bg-success/90"
                      aria-label="Jawab panggilan"
                      aria-describedby={answerBlocked ? "call-permission-help" : undefined}
                      onClick={answerWithPermission}
                    >
                      <PhoneIcon className="size-7" />
                    </Button>
                    <span className="text-[10px] text-on-dark-muted" id="call-permission-help">
                      {answerBlocked
                        ? "Jawab (minta izin)"
                        : permission.audioOnly
                          ? "Jawab (suara)"
                          : "Jawab"}
                    </span>
                  </div>
                  <div className="order-1 flex flex-col items-center gap-1.5">
                    <Button
                      size="icon"
                      className="size-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      aria-label="Tolak panggilan"
                      onClick={session.decline}
                    >
                      <PhoneOff className="size-7" />
                    </Button>
                    <span className="text-[10px] text-on-dark-muted">Tolak</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-4 justify-items-center gap-3">
                  <ControlButton
                    label={session.controls.muted ? "Suara mati" : "Mikrofon"}
                    active={session.controls.muted}
                    disabled={!controlsLive}
                    hint={!controlsLive ? notLiveHint : micGranted ? undefined : micHint}
                    ariaLabel="Bisukan mikrofon"
                    onClick={withPermission(
                      micGranted,
                      micHint,
                      withFeedback(session.toggleMute, () =>
                        session.controls.muted ? "Mikrofon dinyalakan" : "Mikrofon dimatikan",
                      ),
                    )}
                    icon={session.controls.muted ? MicOff : Mic}
                  />
                  <ControlButton
                    label="Kamera"
                    active={!session.controls.cameraOn}
                    disabled={!controlsLive}
                    hint={!controlsLive ? notLiveHint : cameraGranted ? undefined : cameraHint}
                    ariaLabel="Nyalakan kamera"
                    onClick={withPermission(
                      cameraGranted,
                      cameraHint,
                      withFeedback(session.toggleCamera, () =>
                        session.controls.cameraOn ? "Kamera dimatikan" : "Kamera dinyalakan",
                      ),
                      true,
                    )}
                    icon={session.controls.cameraOn ? Video : VideoOff}
                  />
                  {/* Tombol speaker hanya muncul bila rute keluaran memang bisa
                      diatur; kalau tidak, label jujur "Diatur sistem". */}
                  {session.speakerSupported ? (
                    <ControlButton
                      label="Speaker"
                      active={session.controls.speakerOn}
                      disabled={!controlsLive}
                      hint={!controlsLive ? notLiveHint : undefined}
                      ariaLabel="Pengeras suara"
                      onClick={withFeedback(session.toggleSpeaker, () =>
                        session.controls.speakerOn
                          ? "Pengeras suara dimatikan"
                          : "Pengeras suara dinyalakan",
                      )}
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
                    disabled={!controlsLive}
                    hint={!controlsLive ? notLiveHint : cameraGranted ? undefined : cameraHint}
                    ariaLabel="Balik kamera"
                    onClick={withPermission(
                      cameraGranted,
                      cameraHint,
                      withFeedback(session.switchCamera, () => "Kamera dibalik"),
                      true,
                    )}
                    icon={RefreshCcw}
                  />
                  <ControlButton
                    label="Perangkat"
                    active={devicesOpen}
                    hint={!controlsLive ? notLiveHint : micGranted ? undefined : micHint}
                    ariaLabel="Pilih mikrofon, kamera, dan speaker"
                    onClick={withPermission(micGranted, micHint, () => {
                      session.refreshDevices();
                      setDevicesOpen(true);
                      toast("Memuat daftar perangkat…", { duration: 1200 });
                    })}
                    icon={SlidersHorizontal}
                  />
                </div>
                {!controlsLive && (
                  <p className="text-center text-[11px] text-on-dark-muted">
                    Kontrol mikrofon, kamera, dan speaker aktif setelah panggilan dijawab. Tombol
                    merah membatalkan panggilan.
                  </p>
                )}
                <div className="flex justify-center">
                  <Button
                    ref={hangupRef}
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

        <CallDeviceSheet
          open={devicesOpen}
          onOpenChange={setDevicesOpen}
          devices={session.devices}
          micDeviceId={session.micDeviceId}
          cameraDeviceId={session.cameraDeviceId}
          speakerDeviceId={session.speakerDeviceId}
          onPickMic={session.setMicDevice}
          onPickCamera={session.setCameraDevice}
          onPickSpeaker={session.setSpeakerDevice}
          speakerSupported={session.speakerSupported}
          videoEnabled={isVideo}
        />
      </div>
    );
  }

  return (
    <div
      data-call-surface=""
      className="app-gradient flex min-h-dvh flex-col px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-navy-foreground"
    >
      <div className="flex items-center gap-2">
        <Button
          ref={backRef}
          variant="ghost"
          size="icon"
          aria-label="Kembali"
          className="size-11 text-navy-foreground hover:bg-on-dark-surface"
          onClick={backToCalls}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-base font-semibold">Detail panggilan</h1>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <CallStatusLive
          phase={session.phase === "loading" ? "ended" : session.phase}
          kind={isVideo ? "video" : "audio"}
          name={name}
          reason={session.reason}
          endStatus={detail.status}
          durationSec={detail.duration_sec}
          retrying={session.retrying}
        />
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
          <MCMAvatar initials={initials} color="from-navy to-primary" size="xl" />
        )}
        <h2 className="text-2xl font-semibold">{name}</h2>
        <p className="flex items-center gap-1.5 text-sm text-navy-foreground/70">
          {detail.status === "missed" && <PhoneMissed className="size-4 text-destructive" />}
          {isVideo ? <Video className="size-4" /> : <PhoneIcon className="size-4" />}
          {isVideo ? "Panggilan video" : "Panggilan suara"} •{" "}
          {STATUS_LABEL[detail.status] ?? detail.status}
        </p>
      </div>

      {(session.phase === "unconfigured" ||
        (restoredFailure && restored?.phase === "unconfigured")) &&
        !errorDismissed && (
          <CallFailureRecovery
            className="mt-6"
            unconfigured
            trapFocus
            suspendTrap={devicesOpen || voiceOpen}
            fallbackFocus={() => backRef.current}
            reason={session.reason ?? restored?.reason ?? CALL_PROVIDER_NOTICE}
            retrying={session.retrying}
            onRetry={session.retry}
            onOpenProvider={() => void navigate({ to: "/settings/calls" })}
            onDismiss={() => setErrorDismissed(true)}
          />
        )}

      {(session.phase === "error" || (restoredFailure && restored?.phase === "error")) &&
        !errorDismissed && (
          <CallFailureRecovery
            className="mt-6"
            trapFocus
            suspendTrap={devicesOpen || voiceOpen}
            fallbackFocus={() => backRef.current}
            reason={session.reason ?? restored?.reason ?? null}
            retrying={session.retrying}
            onRetry={session.retry}
            onOpenDevices={() => {
              session.refreshDevices();
              setDevicesOpen(true);
            }}
            onOpenProvider={() => void navigate({ to: "/settings/calls" })}
            onDismiss={() => setErrorDismissed(true)}
          />
        )}

      <CallDeviceSheet
        open={devicesOpen}
        onOpenChange={setDevicesOpen}
        devices={session.devices}
        micDeviceId={session.micDeviceId}
        cameraDeviceId={session.cameraDeviceId}
        speakerDeviceId={session.speakerDeviceId}
        onPickMic={session.setMicDevice}
        onPickCamera={session.setCameraDevice}
        onPickSpeaker={session.setSpeakerDevice}
        speakerSupported={session.speakerSupported}
        videoEnabled={isVideo}
      />

      <div className="mt-6 space-y-3 rounded-2xl bg-on-dark-surface p-4 text-sm">
        <Row label="Tanggal" value={tanggalPanjang(detail.created_at)} />
        <Row label="Waktu mulai" value={jam(detail.started_at ?? detail.created_at)} />
        {detail.ended_at && <Row label="Waktu berakhir" value={jam(detail.ended_at)} />}
        <Row label="Durasi" value={durasi(detail.duration_sec)} />
        <Row label="Peserta" value={detail.participants.map((p) => p.display_name).join(", ")} />
      </div>

      <div className="mt-6 rounded-2xl bg-on-dark-surface p-4">
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
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11 shrink-0 rounded-xl px-4"
            onClick={() => setVoiceOpen(true)}
          >
            Atur
          </Button>
        </div>
        <VoicePrivacyBadge
          active={entitlement.active && voicePrefs.enabled && voicePrefs.preset !== "off"}
          className="mt-3"
        />
      </div>

      <div className="mt-auto space-y-3 pt-8">
        <Button
          variant="ghost"
          className="w-full rounded-xl text-navy-foreground/80 hover:bg-on-dark-surface"
          onClick={backToCalls}
        >
          Kembali ke riwayat
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

/** Indikator sinyal jaringan panggilan — jujur mengikuti laporan SFU. */
function SignalBadge({ quality }: { quality: "excellent" | "good" | "poor" | "unknown" }) {
  if (quality === "unknown") return null;
  const map = {
    excellent: { Icon: SignalHigh, text: "Sinyal bagus", tone: "text-success" },
    good: { Icon: SignalMedium, text: "Sinyal sedang", tone: "text-navy-foreground/80" },
    poor: { Icon: SignalLow, text: "Sinyal lemah", tone: "text-destructive" },
  } as const;
  const { Icon, text, tone } = map[quality];
  return (
    <span className={cn("flex items-center gap-1 text-xs", tone)} role="status" aria-label={text}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{text}</span>
    </span>
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
  hint,
  onClick,
  icon: Icon,
}: {
  label: string;
  ariaLabel: string;
  active: boolean;
  disabled?: boolean;
  /** Penjelasan kenapa tombol nonaktif (tooltip + judul aksesibilitas). */
  hint?: string | undefined;
  onClick: () => void;
  icon: typeof Mic;
}) {
  const button = (
    <Button
      size="icon"
      disabled={disabled ?? false}
      aria-label={hint ? `${ariaLabel}. ${hint}` : ariaLabel}
      onClick={onClick}
      className={cn(
        "size-14 rounded-full border border-on-dark-border",
        active
          ? "bg-on-dark text-navy hover:bg-on-dark/80"
          : "bg-on-dark-surface text-on-dark hover:bg-on-dark-surface",
      )}
    >
      <Icon className="size-6" />
    </Button>
  );
  return (
    <div className="flex flex-col items-center gap-1.5">
      {hint ? (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            {/* Tombol nonaktif tidak memancarkan event, jadi pemicu tooltip
                dibungkus span yang tetap bisa disentuh/di-hover. */}
            <TooltipTrigger asChild>
              <span tabIndex={0} title={hint} className="inline-flex rounded-full">
                {button}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-56 text-center">
              {hint}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      )}
      <span className="text-[10px] text-on-dark-muted">{label}</span>
    </div>
  );
}
