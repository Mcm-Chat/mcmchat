/**
 * Layar prapanggilan: memeriksa izin & kualitas mikrofon/kamera sebelum
 * membuat panggilan nyata. Panggilan baru hanya dibuat setelah pengguna
 * menekan "Mulai panggilan", sehingga lawan bicara tidak pernah menerima
 * dering dari perangkat yang mikrofonnya bermasalah.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NotificationBanner } from "@/components/mcm/notification-banner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Phone, ShieldAlert, Video, VideoOff } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { CallStatusLive } from "@/components/mcm/call-status-live";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useRequireAuth } from "@/lib/api/guard";
import { startCall, CALL_PROVIDER_NOTICE } from "@/lib/api/calls";
import { getCallConfig } from "@/lib/calls/calls.functions";

type Kind = "audio" | "video";

export const Route = createFileRoute("/call/prepare/$conversationId")({
  head: () => ({
    meta: [
      { title: "Cek perangkat sebelum panggilan — MCM" },
      {
        name: "description",
        content:
          "Periksa mikrofon dan kamera, lalu pilih panggilan suara atau video sebelum menghubungi kontak MCM.",
      },
      { property: "og:title", content: "Cek perangkat sebelum panggilan — MCM" },
      {
        property: "og:description",
        content: "Uji mikrofon dan kamera sebelum memulai panggilan MCM.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { kind?: Kind | undefined } => ({
    kind: s["kind"] === "video" ? "video" : s["kind"] === "audio" ? "audio" : undefined,
  }),
  component: PreCallScreen,
});

type MediaState = "idle" | "processing" | "ready" | "error";
type PermissionKind = "denied" | "notfound" | "busy" | "unknown";

/** Klasifikasi kegagalan getUserMedia agar pesan izin bisa spesifik. */
function classifyMediaError(err: unknown): PermissionKind {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return "notfound";
  if (name === "NotReadableError" || name === "TrackStartError") return "busy";
  return "unknown";
}

/** Pesan izin yang dibacakan pembaca layar dan ditampilkan di banner. */
function permissionMessage(kind: PermissionKind, camOn: boolean): string {
  const perangkat = camOn ? "kamera dan mikrofon" : "mikrofon";
  switch (kind) {
    case "denied":
      return `Izin ${perangkat} ditolak. Buka pengaturan izin situs di browser atau perangkat, izinkan ${perangkat}, lalu tekan tombol Coba lagi.`;
    case "notfound":
      return `Perangkat ${perangkat} tidak ditemukan. Sambungkan perangkat lalu tekan Coba lagi.`;
    case "busy":
      return `Perangkat ${perangkat} sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu tekan Coba lagi.`;
    default:
      return `Tidak bisa mengakses ${perangkat}. Periksa izin perangkat lalu tekan Coba lagi.`;
  }
}

/** Teks status media yang dibacakan pembaca layar. */
function mediaStatusText(
  state: MediaState,
  micOn: boolean,
  camOn: boolean,
  permission: PermissionKind | null,
): string {
  if (state === "processing") return "Memproses perangkat — meminta akses kamera dan mikrofon…";
  if (state === "error") return `Gagal — ${permissionMessage(permission ?? "unknown", camOn)}`;
  if (state === "idle") return "Kamera dan mikrofon dimatikan.";
  if (micOn && camOn) return "Siap — kamera dan mikrofon aktif.";
  if (camOn) return "Siap — kamera aktif.";
  return "Siap — mikrofon aktif.";
}

function PreCallScreen() {
  const { conversationId } = Route.useParams();
  const { kind: initialKind } = Route.useSearch();
  const navigate = useNavigate();
  const { loading } = useRequireAuth();
  const loadCallConfig = useServerFn(getCallConfig);

  const [kind, setKind] = useState<Kind>(initialKind ?? "audio");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(initialKind === "video");
  const [level, setLevel] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaState, setMediaState] = useState<MediaState>("idle");
  const [permission, setPermission] = useState<PermissionKind | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    void loadCallConfig()
      .then((c) => setConfigured(!!c.configured))
      .catch(() => setConfigured(false));
  }, [loadCallConfig]);

  const stopMedia = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  // Pratinjau perangkat: dibangun ulang tiap kali mic/kamera di-toggle.
  useEffect(() => {
    let cancelled = false;
    stopMedia();
    if (!micOn && !camOn) {
      setMediaState("idle");
      setPermission(null);
      setMediaError(null);
      return;
    }
    setMediaState("processing");

    void navigator.mediaDevices
      .getUserMedia({ audio: micOn, video: camOn ? { facingMode: "user" } : false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMediaError(null);
        setPermission(null);
        setMediaState("ready");
        if (videoRef.current && camOn) videoRef.current.srcObject = stream;
        if (!micOn) return;
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        await ctx.resume().catch(() => undefined);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setLevel((prev) => Math.max(peak, prev * 0.82));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const kind = classifyMediaError(err);
        setMediaState("error");
        setPermission(kind);
        setMediaError(permissionMessage(kind, camOn));
        // Fokuskan tombol coba lagi agar pengguna keyboard langsung sampai ke aksi pemulihan.
        requestAnimationFrame(() => retryRef.current?.focus());
      });

    return () => {
      cancelled = true;
      stopMedia();
    };
  }, [micOn, camOn, stopMedia, retryToken]);

  // Memilih video otomatis menyalakan kamera; memilih suara mematikannya.
  const pickKind = (next: Kind) => {
    setKind(next);
    setCamOn(next === "video");
  };

  const begin = async () => {
    if (configured === false) {
      setError(CALL_PROVIDER_NOTICE);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const created = await startCall(conversationId, kind === "video" && camOn ? "video" : "audio");
      stopMedia();
      void navigate({ to: "/call/$id", params: { id: created.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Panggilan gagal dimulai.");
    } finally {
      setStarting(false);
    }
  };

  const bars = Array.from({ length: 12 });

  return (
    <AppShell nav={false} header={<MobileHeader title="Cek perangkat" back />}>
      <div className="space-y-5 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <section className="relative aspect-[4/3] overflow-hidden rounded-2xl border bg-muted">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn("size-full object-cover", camOn ? "block" : "hidden")}
          />
          {!camOn && (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <VideoOff className="size-8" />
              <p className="text-sm">Kamera nonaktif — panggilan suara saja</p>
            </div>
          )}
        </section>

        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-xs text-muted-foreground"
        >
          {mediaStatusText(mediaState, micOn, camOn, permission)}
        </p>

        {mediaError && (
          <NotificationBanner
            role="alert"
            icon={<ShieldAlert className="size-4" />}
            onDismiss={() => setMediaError(null)}
            dismissLabel="Tutup peringatan media"
            className="items-center rounded-xl bg-destructive/10 p-3 text-destructive"
          >
            <span className="flex flex-col items-start gap-2">
              <span>{mediaError}</span>
              <Button
                ref={retryRef}
                type="button"
                size="sm"
                variant="outline"
                className="min-h-9"
                onClick={() => {
                  setMediaError(null);
                  setMediaState("processing");
                  setRetryToken((n) => n + 1);
                }}
              >
                Coba lagi minta izin
              </Button>
            </span>
          </NotificationBanner>
        )}

        <section className="space-y-3 rounded-2xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              Mikrofon
            </div>
            <Switch checked={micOn} onCheckedChange={setMicOn} aria-label="Aktifkan mikrofon" />
          </div>
          <div className="flex items-center gap-1" aria-label="Level mikrofon">
            {bars.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-3 flex-1 rounded-full transition-colors",
                  micOn && level * 12 > i ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {micOn
              ? level > 0.03
                ? "Suara terdeteksi — mikrofon siap."
                : "Coba bicara untuk menguji mikrofon."
              : "Mikrofon dimatikan. Lawan bicara tidak akan mendengar Anda."}
          </p>

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {camOn ? <Video className="size-4" /> : <VideoOff className="size-4" />}
              Kamera
            </div>
            <Switch
              checked={camOn}
              onCheckedChange={(v) => {
                setCamOn(v);
                setKind(v ? "video" : "audio");
              }}
              aria-label="Aktifkan kamera"
            />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          {(["audio", "video"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              aria-pressed={kind === k}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-sm font-medium transition-colors",
                kind === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {k === "audio" ? <Phone className="size-5" /> : <Video className="size-5" />}
              {k === "audio" ? "Panggilan suara" : "Panggilan video"}
            </button>
          ))}
        </section>

        {configured === false && (
          <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            {CALL_PROVIDER_NOTICE}
          </p>
        )}
        <CallStatusLive
          phase={
            error
              ? "error"
              : configured === false
                ? "unconfigured"
                : starting
                  ? "connecting"
                  : "loading"
          }
          kind={kind}
          name="kontak"
          reason={error}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          className="min-h-12 w-full rounded-xl"
          disabled={loading || starting || configured === false}
          onClick={() => void begin()}
        >
          {starting ? "Memulai…" : kind === "video" ? "Mulai panggilan video" : "Mulai panggilan suara"}
        </Button>
      </div>
    </AppShell>
  );
}
