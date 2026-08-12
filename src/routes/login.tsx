import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMCM } from "@/lib/mcm/store";
import logo from "@/assets/mcm-logo.png";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Masuk ke MCM" },
      { name: "description", content: "Masuk ke akun MCM Anda atau coba langsung lewat mode demo tanpa kredensial." },
      { property: "og:title", content: "Masuk ke MCM" },
      { property: "og:description", content: "Masuk ke akun MCM atau coba mode demo." },
    ],
  }),
  component: LoginPage,
});

const schema = z.object({
  identifier: z
    .string()
    .trim()
    .min(6, { message: "Masukkan nomor telepon atau email yang valid" })
    .max(120, { message: "Maksimal 120 karakter" }),
  password: z.string().min(6, { message: "Kata sandi minimal 6 karakter" }).max(72),
});

function LoginPage() {
  const { update, resetDemo } = useMCM();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ identifier, password });
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
      update((d) => ({ ...d, authed: true, onboarded: true }));
      toast.success("Berhasil masuk. Selamat datang kembali!");
      navigate({ to: "/chat" });
    }, 900);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
        <div className="text-center">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="mx-auto size-16" />
          <h1 className="mt-3 text-2xl font-bold">Masuk ke MCM</h1>
          <p className="mt-1 text-sm text-muted-foreground">Kelola chat, panggilan, dan catatan keuangan Anda.</p>
        </div>
        <form className="card-soft space-y-4 p-5" onSubmit={submit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="identifier">Nomor telepon atau email</Label>
            <Input
              id="identifier"
              value={identifier}
              maxLength={120}
              placeholder="0812xxxxxxx atau nama@email.com"
              onChange={(e) => setIdentifier(e.target.value)}
              aria-invalid={!!errors['identifier']}
            />
            {errors['identifier'] && <p className="text-xs text-destructive">{errors['identifier']}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Kata sandi</Label>
            <Input
              id="password"
              type="password"
              value={password}
              maxLength={72}
              placeholder="Minimal 6 karakter"
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors['password']}
            />
            {errors['password'] && <p className="text-xs text-destructive">{errors['password']}</p>}
          </div>
          <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />} Masuk
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-11 w-full rounded-xl"
            onClick={() => {
              resetDemo();
              toast.success("Mode demo aktif sebagai Andi Pratama");
              navigate({ to: "/chat" });
            }}
          >
            Coba mode demo
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Belum punya akun?{" "}
          <Link to="/register" className="font-semibold text-primary">
            Daftar
          </Link>
        </p>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Privasi terlindungi • autentikasi masih prototipe lokal
        </p>
      </div>
    </div>
  );
}
