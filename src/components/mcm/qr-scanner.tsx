import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  Camera,
  CameraOff,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Settings,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseContactScan } from "@/lib/contacts/scan";
import { openAppSettings } from "@/lib/push/permissions";

/** Ambil PIN dari isi QR: `mcm://contact/<pin>`, tautan MCM, payload JSON, atau PIN polos. */
export function extractPin(raw: string): string | null {
  return parseContactScan(raw);
}

type CamPhase = "idle" | "requesting" | "streaming" | "denied" | "missing" | "busy" | "unsupported";

const PHASE_COPY: Record<Exclude<CamPhase, "idle" | "requesting" | "streaming">, string> = {
  denied:
    "Izin kamera ditolak. Aktifkan izin kamera untuk aplikasi ini, lalu tekan Coba lagi — atau pindai QR dari galeri foto.",
  missing: "Tidak ada kamera yang terdeteksi di perangkat ini. Gunakan pindai dari galeri foto.",
  busy: "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu tekan Coba lagi.",
  unsupported:
    "Peramban ini tidak mendukung akses kamera. Buka lewat aplikasi MCM atau pindai dari galeri foto.",
};

export function QrScannerDialog({
  open,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResult: (pin: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [phase, setPhase] = useState<CamPhase>("idle");
  const [attempt, setAttempt] = useState(0);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchAvailable(false);
    setTorchOn(false);
  }, []);

  const accept = useCallback(
    (raw: string) => {
      const pin = extractPin(raw);
      if (!pin) return false;
      doneRef.current = true;
      stop();
      onOpenChange(false);
      onResult(pin);
      return true;
    },
    [onOpenChange, onResult, stop],
  );

  useEffect(() => {
    if (!open) {
      stop();
      setPhase("idle");
      return;
    }
    doneRef.current = false;
    setPhase("requesting");
    let cancelled = false;

    const tick = () => {
      const video = videoRef.current;
      if (!video || doneRef.current) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const canvas = (canvasRef.current ??= document.createElement("canvas"));
        const w = Math.min(640, video.videoWidth);
        const h = Math.round((video.videoHeight / video.videoWidth) * w);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const found = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
          if (found?.data && accept(found.data)) return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          if (!cancelled) setPhase("unsupported");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setPhase("streaming");
        const track = stream.getVideoTracks()[0];
        const caps = (
          track?.getCapabilities as (() => MediaTrackCapabilities & { torch?: boolean }) | undefined
        )?.call(track);
        setTorchAvailable(Boolean(caps?.torch));
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setPhase(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "missing"
              : name === "NotReadableError" || name === "AbortError"
                ? "busy"
                : "denied",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, attempt, accept, stop]);

  const scanFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.drawImage(bitmap, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, canvas.width, canvas.height);
      if (!found?.data || !accept(found.data)) {
        toast.error("QR tidak terbaca atau bukan QR PIN MCM");
      }
    } catch {
      toast.error("Gagal membaca gambar");
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
      toast.info("Lampu flash tidak bisa diatur di perangkat ini.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Pindai QR PIN</DialogTitle>
          <DialogDescription>Arahkan kamera ke QR Code PIN MCM milik teman Anda.</DialogDescription>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="size-full object-cover"
            aria-label="Pratinjau kamera pemindai QR"
          />
          {/* Overlay panduan: area gelap + bingkai sudut + garis pindai */}
          {phase === "streaming" && (
            <>
              <div className="pointer-events-none absolute inset-0 bg-black/45 [clip-path:polygon(0_0,100%_0,100%_100%,0_100%,0_14%,14%_14%,14%_86%,86%_86%,86%_14%,0_14%)]" />
              <div className="pointer-events-none absolute inset-[14%]">
                <span className="absolute -left-0.5 -top-0.5 size-8 rounded-tl-xl border-l-4 border-t-4 border-primary" />
                <span className="absolute -right-0.5 -top-0.5 size-8 rounded-tr-xl border-r-4 border-t-4 border-primary" />
                <span className="absolute -bottom-0.5 -left-0.5 size-8 rounded-bl-xl border-b-4 border-l-4 border-primary" />
                <span className="absolute -bottom-0.5 -right-0.5 size-8 rounded-br-xl border-b-4 border-r-4 border-primary" />
                <span className="absolute inset-x-2 top-1/2 h-0.5 animate-pulse rounded-full bg-primary/80" />
              </div>
              <p className="pointer-events-none absolute inset-x-4 bottom-3 text-center text-[11px] font-medium text-white drop-shadow">
                Posisikan QR di dalam bingkai — pemindaian otomatis
              </p>
              {torchAvailable && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  aria-pressed={torchOn}
                  aria-label={torchOn ? "Matikan lampu flash" : "Nyalakan lampu flash"}
                  className="absolute right-3 top-3 size-11 rounded-full shadow-lg"
                  onClick={() => void toggleTorch()}
                >
                  {torchOn ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
                </Button>
              )}
            </>
          )}
          {phase === "requesting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 p-4 text-center text-xs text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />
              Meminta izin kamera… setujui permintaan izin yang muncul.
            </div>
          )}
          {phase !== "idle" && phase !== "requesting" && phase !== "streaming" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center">
              <CameraOff className="size-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{PHASE_COPY[phase]}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setAttempt((a) => a + 1)}
                >
                  <RefreshCw className="size-4" /> Coba lagi
                </Button>
                {phase === "denied" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => {
                      void openAppSettings().then((ok) => {
                        if (!ok)
                          toast.info(
                            "Buka setelan peramban/aplikasi → Izin → Kamera untuk mengizinkan MCM.",
                          );
                      });
                    }}
                  >
                    <Settings className="size-4" /> Buka setelan
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-12 rounded-xl"
            disabled={phase !== "streaming"}
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          >
            <SwitchCamera className="size-4" /> Ganti kamera
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-xl"
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon className="size-4" /> Dari galeri
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-xl"
            onClick={() => setAttempt((a) => a + 1)}
          >
            <RefreshCw className="size-4" /> Ulangi pindai
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-12 rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" /> Batal
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void scanFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ScanQrButton({ onResult }: { onResult: (pin: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full rounded-xl"
        onClick={() => setOpen(true)}
      >
        <Camera className="size-4" /> Pindai QR dengan kamera
      </Button>
      <QrScannerDialog open={open} onOpenChange={setOpen} onResult={onResult} />
    </>
  );
}
