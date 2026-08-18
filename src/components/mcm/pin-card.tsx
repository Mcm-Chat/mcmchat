import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function copyText(value: string, message = "Disalin ke papan klip") {
  const done = () => toast.success(message);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(value)
      .then(done)
      .catch(() => toast.error("Gagal menyalin"));
  } else {
    toast.error("Papan klip tidak tersedia di peramban ini");
  }
}

export function QRCard({
  pin,
  label,
  className,
}: {
  pin: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("card-soft flex flex-col items-center gap-3 p-5", className)}>
      <div className="rounded-2xl bg-qr-surface p-3">
        <QRCodeSVG
          value={`mcm://pin/${pin}`}
          size={168}
          level="M"
          bgColor="#ffffff"
          fgColor="#14212f"
        />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold">{label}</p>
        <p className="font-mono text-lg tracking-[0.2em]">{pin}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pindai untuk mengirim permintaan kontak
        </p>
      </div>
    </div>
  );
}

export function PinCard({ pin, name, subtitle }: { pin: string; name: string; subtitle?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="app-gradient relative overflow-hidden rounded-2xl p-5 text-navy-foreground shadow-soft">
      <div className="absolute -top-10 -right-10 size-32 rounded-full bg-on-dark-surface" />
      <div className="absolute -bottom-12 -left-6 size-28 rounded-full bg-on-dark-surface" />
      <div className="relative">
        <p className="text-[11px] tracking-widest text-navy-foreground/70 uppercase">PIN MCM</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-[0.18em]">{pin}</p>
        <p className="mt-1 text-sm text-navy-foreground/80">{name}</p>
        {subtitle && <p className="text-xs text-navy-foreground/60">{subtitle}</p>}
        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="rounded-xl"
            onClick={() => {
              copyText(pin, "PIN disalin");
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Tersalin" : "Salin PIN"}
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="secondary" className="rounded-xl">
                <QrCode className="size-4" /> QR Code
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[340px] rounded-2xl">
              <DialogHeader>
                <DialogTitle>QR Code PIN</DialogTitle>
                <DialogDescription>
                  Tunjukkan kode ini agar orang lain bisa menambahkan Anda.
                </DialogDescription>
              </DialogHeader>
              <QRCard pin={pin} label={name} />
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() =>
                  copyText(`Tambahkan saya di MCM dengan PIN ${pin}`, "Undangan disalin")
                }
              >
                <Share2 className="size-4" /> Salin teks undangan
              </Button>
            </DialogContent>
          </Dialog>
        </div>
        <p className="mt-3 text-[11px] text-navy-foreground/60">
          Nomor telepon dan email Anda tidak pernah ditampilkan ke pengguna lain.
        </p>
      </div>
    </div>
  );
}
