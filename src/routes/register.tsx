import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PinCard } from "@/components/mcm/pin-card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/mcm-logo.png";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/register")({
  head: () => ({
    links: canonical("/register").links,
    meta: [
      ...canonical("/register").meta,
      { title: "Daftar akun MCM" },
      {
        name: "description",
        content: "Buat akun MCM dan dapatkan PIN unik 8 karakter sebagai identitas publik Anda.",
      },
      { property: "og:title", content: "Daftar akun MCM" },
      {
        property: "og:description",
        content: "Dapatkan PIN MCM unik tanpa membagikan nomor telepon.",
      },
    ],
  }),
  component: RegisterPage,
});

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(3, { message: "Nama minimal 3 karakter" })
    .max(60, { message: "Maksimal 60 karakter" }),
  email: z.string().trim().email({ message: "Masukkan email yang valid" }).max(160),
  password: z.string().min(8, { message: "Kata sandi minimal 8 karakter" }).max(72),
});

const DEMO_OTP = "123456";
const STEP_LABEL = ["Daftar", "Verifikasi", "Profil awal"];

function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState({ name: "", email: "", password: "", bio: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [pin, setPin] = useState("");
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 2) otpRef.current?.focus();
  }, [step]);

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { display_name: parsed.data.name },
      },
    });
    if (error) {
      setLoading(false);
      toast.error(
        error.message.includes("already registered")
          ? "Email sudah terdaftar. Silakan masuk."
          : "Pendaftaran gagal. Coba lagi.",
      );
      return;
    }
    let session = data.session;
    if (!session) {
      // Konfirmasi email dimatikan untuk MVP; kalau sesi belum ada, langsung masuk.
      const signIn = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });
      if (signIn.error || !signIn.data.session) {
        setLoading(false);
        toast.error("Akun dibuat, tapi gagal masuk otomatis. Silakan masuk manual.");
        void navigate({ to: "/login" });
        return;
      }
      session = signIn.data.session;
    }
    await refresh();
    setLoading(false);
    setStep(2);
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.trim() !== DEMO_OTP) {
      setOtpError(`Kode salah. Untuk demo, gunakan ${DEMO_OTP}.`);
      return;
    }
    setOtpError("");
    setLoading(true);
    const { myPin } = await import("@/lib/api/pins");
    setPin(await myPin().catch(() => ""));
    setLoading(false);
    setStep(3);
  };

  const finishProfile = async () => {
    setLoading(true);
    const bio = form.bio.trim();
    await supabase
      .rpc("update_my_profile", {
        _display_name: form.name.trim(),
        _bio: bio || null,
      })
      .then(({ error }) => {
        if (error) toast.error("Profil belum tersimpan, bisa diubah lagi di halaman Profil.");
      });
    await refresh();
    void navigate({ to: "/chat", replace: true });
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-6 py-10">
        <div className="text-center">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="mx-auto size-14" />
          <h1 className="mt-2 text-2xl font-bold">
            {step === 1 ? "Buat akun MCM" : step === 2 ? "Verifikasi kode" : "Profil awal Anda"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === 1
              ? "Email hanya untuk masuk, tidak ditampilkan ke pengguna lain."
              : step === 2
                ? `Mode demo: masukkan kode ${DEMO_OTP} untuk melanjutkan.`
                : "Lengkapi profil, lalu Anda langsung masuk ke tab Chat."}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            {STEP_LABEL.map((label, i) => (
              <span
                key={label}
                className={
                  i + 1 <= step
                    ? "h-1.5 w-10 rounded-full bg-primary"
                    : "h-1.5 w-6 rounded-full bg-muted"
                }
                aria-label={`Langkah ${i + 1}: ${label}`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <form className="card-soft space-y-4 p-5" onSubmit={(e) => void submit(e)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name">Nama lengkap</Label>
              <Input
                id="name"
                value={form.name}
                maxLength={60}
                placeholder="Contoh: Andi Pratama"
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!errors["name"]}
              />
              {errors["name"] && <p className="text-xs text-destructive">{errors["name"]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                maxLength={160}
                placeholder="nama@email.com"
                onChange={(e) => set("email", e.target.value)}
                aria-invalid={!!errors["email"]}
              />
              {errors["email"] && <p className="text-xs text-destructive">{errors["email"]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Kata sandi</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                maxLength={72}
                placeholder="Minimal 8 karakter"
                onChange={(e) => set("password", e.target.value)}
                aria-invalid={!!errors["password"]}
              />
              {errors["password"] && (
                <p className="text-xs text-destructive">{errors["password"]}</p>
              )}
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Membuat akun…" : "Lanjut"}
            </Button>
          </form>
        )}

        {step === 2 && (
          <form className="card-soft space-y-4 p-5" onSubmit={(e) => void verifyOtp(e)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="otp">Kode verifikasi (demo)</Label>
              <Input
                id="otp"
                ref={otpRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                placeholder="6 digit"
                className="text-center text-lg tracking-[0.5em]"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                aria-invalid={!!otpError}
              />
              {otpError && <p className="text-xs text-destructive">{otpError}</p>}
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Memverifikasi…" : "Lanjut"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={loading}
              onClick={() => setOtp(DEMO_OTP)}
            >
              Isi kode demo otomatis
            </Button>
          </form>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <PinCard
              pin={pin}
              name={form.name}
              subtitle="PIN tidak mengandung karakter 0, O, I, atau 1"
            />
            <div className="card-soft space-y-2 p-5">
              <Label htmlFor="bio">Bio singkat (opsional)</Label>
              <Textarea
                id="bio"
                value={form.bio}
                maxLength={140}
                placeholder="Contoh: Pemilik Kopi Nusa • Bandung"
                onChange={(e) => set("bio", e.target.value)}
              />
              <p className="text-right text-[11px] text-muted-foreground">{form.bio.length}/140</p>
            </div>
            <div className="card-soft flex items-start gap-2 p-4 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              PIN dibuat otomatis dan unik. Anda bisa menyalin atau membagikan QR kapan saja dari
              halaman Profil.
            </div>
            <Button
              className="h-11 w-full rounded-xl"
              disabled={loading}
              onClick={() => void finishProfile()}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Menyiapkan aplikasi…" : "Selesai & mulai chat"}
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
          <ShieldCheck className="size-3.5" /> Nomor telepon tidak diperlukan. Identitas publik Anda
          hanya PIN.
        </p>
      </div>
    </div>
  );
}
