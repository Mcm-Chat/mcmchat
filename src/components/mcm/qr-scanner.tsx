import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Camera, Image as ImageIcon, SwitchCamera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { normalizePin, isValidPin } from "@/lib/api/contacts";

/** Ambil PIN dari isi QR: "mcm://pin/A2B3-C4D5", URL, atau PIN polos. */
export function extractPin(raw: string): string | null {
  const text = raw.trim();
  const direct = normalizePin(text.replace(/^mcm:\/\/pin\//i, ""));
  if (isValidPin(direct)) return direct;
  const match = text.toUpperCase().match(/[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}/);
  if (match) {
    const pin = normalizePin(match[0]);
    if (isValidPin(pin)) return pin;
  }
  return null;
}

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
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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
      return;
    }
    doneRef.current = false;
    setError(null);
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
          throw new Error("Kamera tidak tersedia di peramban ini");
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
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError(
          "Tidak bisa membuka kamera. Izinkan akses kamera, atau pindai dari galeri foto di bawah.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, facing, accept, stop]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[360px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Pindai QR PIN</DialogTitle>
          <DialogDescription>
            Arahkan kamera ke QR Code PIN MCM milik teman Anda.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="size-full object-cover"
            aria-label="Pratinjau kamera pemindai QR"
          />
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-primary/80" />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-4 text-center text-xs text-muted-foreground">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-11 flex-1 rounded-xl"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          >
            <SwitchCamera className="size-4" /> Ganti kamera
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 rounded-xl"
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon className="size-4" /> Dari galeri
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
