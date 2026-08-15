/**
 * Layar prapanggilan: memeriksa izin & kualitas mikrofon/kamera sebelum
 * membuat panggilan nyata. Panggilan baru hanya dibuat setelah pengguna
 * menekan "Mulai panggilan", sehingga lawan bicara tidak pernah menerima
 * dering dari perangkat yang mikrofonnya bermasalah.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Phone, ShieldAlert, Video, VideoOff } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
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
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
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
    if (!micOn && !camOn) return;

    void navigator.mediaDevices
      .getUserMedia({ audio: micOn, video: camOn ? { facingMode: "user" } : false })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMediaError(null);
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
      .catch(() => {
        if (cancelled) return;
        setMediaError(
          camOn
            ? "Tidak bisa mengakses kamera/mikrofon. Periksa izin perangkat."
            : "Tidak bisa mengakses mikrofon. Periksa izin perangkat.",
        );
      });

    return () => {
      cancelled = true;
      stopMedia();
    };
  }, [micOn, camOn, stopMedia]);

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

        {mediaError && (
          <p
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            {mediaError}
          </p>
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
