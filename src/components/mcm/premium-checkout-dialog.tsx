import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldAlert, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rupiah, saveSimulation, type PremiumPlan } from "@/lib/premium/plans";

const METHODS = [
  { id: "qris", label: "QRIS", icon: Wallet },
  { id: "transfer", label: "Transfer bank", icon: CreditCard },
];

const STEPS = [
  "Membuat tagihan simulasi…",
  "Menunggu konfirmasi pembayaran…",
  "Memverifikasi hasil…",
];

/**
 * Simulasi alur pembayaran premium. Tidak ada transaksi nyata dan tidak ada
 * entitlement yang diaktifkan — hasilnya hanya dicatat lokal sebagai catatan uji.
 */
export function PremiumCheckoutDialog({
  plan,
  onOpenChange,
  onDone,
}: {
  plan: PremiumPlan | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!plan) {
      setMethod(null);
      setStep(-1);
      setDone(false);
    }
  }, [plan]);

  useEffect(() => {
    if (step < 0 || step >= STEPS.length || !plan || !method) return undefined;
    const t = setTimeout(() => {
      if (step === STEPS.length - 1) {
        saveSimulation({ planId: plan.id, method, at: new Date().toISOString() });
        setDone(true);
        onDone();
      }
      setStep((s) => s + 1);
    }, 900);
    return () => clearTimeout(t);
  }, [step, plan, method, onDone]);

  return (
    <Dialog open={Boolean(plan)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>{done ? "Simulasi selesai" : "Simulasi pembayaran"}</DialogTitle>
          <DialogDescription>
            {plan ? `${plan.name} • ${rupiah(plan.price)}${plan.period}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Mode uji: penyedia pembayaran belum tersambung. Tidak ada uang yang ditagih dan
            langganan premium tidak diaktifkan.
          </p>
        </div>

        {done ? (
          <div className="space-y-3 py-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-success" aria-hidden />
              Alur pembayaran berjalan penuh tanpa error.
            </p>
            <p className="text-xs text-muted-foreground">
              Hasil ini dicatat sebagai simulasi. Status premium tetap non-aktif sampai penagihan
              nyata tersambung.
            </p>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Tutup
            </Button>
          </div>
        ) : step < 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Pilih metode pembayaran simulasi</p>
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMethod(m.id);
                  setStep(0);
                }}
                className="flex w-full min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60"
              >
                <m.icon className="size-4 text-primary" aria-hidden />
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <ul className="space-y-2 py-1" aria-live="polite">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  i > step && "text-muted-foreground/60",
                )}
              >
                {i < step ? (
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                ) : i === step ? (
                  <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                ) : (
                  <span className="size-4 rounded-full border" aria-hidden />
                )}
                {s}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
