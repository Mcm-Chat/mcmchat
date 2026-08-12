import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { PinCard } from "@/components/mcm/pin-card";
import { generatePin } from "@/lib/mcm/demo";
import { useMCM } from "@/lib/mcm/store";
import logo from "@/assets/mcm-logo.png";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Daftar akun MCM" },
      { name: "description", content: "Buat akun MCM dan dapatkan PIN unik 8 karakter sebagai identitas publik Anda." },
      { property: "og:title", content: "Daftar akun MCM" },
      { property: "og:description", content: "Dapatkan PIN MCM unik tanpa membagikan nomor telepon." },
    ],
  }),
  component: RegisterPage,
});

const step1Schema = z.object({
  name: z.string().trim().min(3, { message: "Nama minimal 3 karakter" }).max(60, { message: "Maksimal 60 karakter" }),
  phone: z
    .string()
    .trim()
    .regex(/^(\+62|62|0)8[1-9][0-9]{6,11}$/, { message: "Gunakan format nomor Indonesia, contoh 081234567890" }),
  password: z.string().min(8, { message: "Kata sandi minimal 8 karakter" }).max(72),
});

function RegisterPage() {
  const { update } = useMCM();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState({ name: "", phone: "", password: "", bio: "" });
  const [otp, setOtp] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState("");

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const submitStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = step1Schema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep(2);
      toast.info("Kode OTP demo: 123456");
    }, 800);
  };

  const verifyOtp = () => {
    if (otp !== "123456") {
      toast.error("Kode OTP salah. Untuk demo gunakan 123456.");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setPin(generatePin());
      setStep(3);
    }, 700);
  };

  const finish = () => {
    const initials = form.name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    update((d) => ({
      ...d,
      authed: true,
      onboarded: true,
      profile: {
        ...d.profile,
        name: form.name,
        pin,
        initials: initials || "MC",
        bio: form.bio.trim() || "Pengguna MCM",
        phoneMasked: `${form.phone.slice(0, 5)}•••••${form.phone.slice(-3)}`,
      },
    }));
    toast.success("Akun siap digunakan!");
    navigate({ to: "/chat" });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 px-6 py-10">
        <div className="text-center">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="mx-auto size-14" />
          <h1 className="mt-2 text-2xl font-bold">
            {step === 1 ? "Buat akun MCM" : step === 2 ? "Verifikasi OTP" : step === 3 ? "PIN MCM Anda" : "Lengkapi profil"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === 1
              ? "Nomor Anda hanya untuk verifikasi, tidak ditampilkan ke pengguna lain."
              : step === 2
                ? `Kami mengirim 6 digit kode ke ${form.phone || "nomor Anda"}.`
                : step === 3
                  ? "Ini identitas publik Anda. Bagikan PIN, bukan nomor telepon."
                  : "Satu langkah terakhir sebelum mulai."}
          </p>
        </div>

        {step === 1 && (
          <form className="card-soft space-y-4 p-5" onSubmit={submitStep1} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name">Nama lengkap</Label>
              <Input id="name" value={form.name} maxLength={60} placeholder="Contoh: Andi Pratama" onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Nomor telepon</Label>
              <Input id="phone" inputMode="tel" value={form.phone} maxLength={16} placeholder="081234567890" onChange={(e) => set("phone", e.target.value)} aria-invalid={!!errors.phone} />
              {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Kata sandi</Label>
              <Input id="password" type="password" value={form.password} maxLength={72} placeholder="Minimal 8 karakter" onChange={(e) => set("password", e.target.value)} aria-invalid={!!errors.password} />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />} Kirim kode OTP
            </Button>
          </form>
        )}

        {step === 2 && (
          <div className="card-soft space-y-4 p-5">
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <p className="text-center text-xs text-muted-foreground">Mode demo: gunakan kode 123456</p>
            <Button className="h-11 w-full rounded-xl" onClick={verifyOtp} disabled={otp.length < 6 || loading}>
              {loading && <Loader2 className="size-4 animate-spin" />} Verifikasi
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => toast.info("Kode OTP demo dikirim ulang: 123456")}>
              Kirim ulang kode
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <PinCard pin={pin} name={form.name} subtitle="PIN tidak mengandung karakter 0, O, I, atau 1" />
            <div className="card-soft flex items-start gap-2 p-4 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              PIN dibuat otomatis dan unik. Anda bisa menyalin atau membagikan QR kapan saja dari halaman Profil.
            </div>
            <Button className="h-11 w-full rounded-xl" onClick={() => setStep(4)}>
              Lanjut
            </Button>
          </div>
        )}

        {step === 4 && (
          <div className="card-soft space-y-4 p-5">
            <div className="space-y-1.5">
              <Label htmlFor="bio">Bio singkat</Label>
              <Textarea
                id="bio"
                value={form.bio}
                maxLength={140}
                placeholder="Contoh: Pemilik Kopi Nusa • Bandung"
                onChange={(e) => set("bio", e.target.value)}
              />
              <p className="text-right text-[11px] text-muted-foreground">{form.bio.length}/140</p>
            </div>
            <Button className="h-11 w-full rounded-xl" onClick={finish}>
              Selesai & masuk
            </Button>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Sudah punya akun?{" "}
          <Link to="/login" className="font-semibold text-primary">
            Masuk
          </Link>
        </p>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Privasi terlindungi • pendaftaran masih prototipe lokal
        </p>
      </div>
    </div>
  );
}
