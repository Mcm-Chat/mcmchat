import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import logo from "@/assets/mcm-logo.png";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/login")({
  head: () => ({
    links: canonical("/login").links,
    meta: [
      ...canonical("/login").meta,
      { title: "Masuk ke MCM" },
      {
        name: "description",
        content: "Masuk ke akun MCM dengan email dan kata sandi Anda.",
      },
      { property: "og:title", content: "Masuk ke MCM" },
      { property: "og:description", content: "Masuk ke akun MCM Anda." },
    ],
  }),
  component: LoginPage,
});

const schema = z.object({
  email: z.string().trim().email({ message: "Masukkan email yang valid" }).max(160),
  password: z.string().min(6, { message: "Kata sandi minimal 6 karakter" }).max(72),
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && session) void navigate({ to: "/chat", replace: true });
  }, [authLoading, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.includes("Invalid login")
          ? "Email atau kata sandi salah."
          : "Gagal masuk. Coba lagi.",
      );
      return;
    }
    toast.success("Berhasil masuk.");
    void navigate({ to: "/chat", replace: true });
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
        <div className="text-center">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="mx-auto size-16" />
          <h1 className="mt-3 text-2xl font-bold">Masuk ke MCM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola chat, panggilan, dan catatan keuangan Anda.
          </p>
        </div>
        <form className="card-soft space-y-4 p-5" onSubmit={(e) => void submit(e)} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              maxLength={160}
              placeholder="nama@email.com"
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors["email"]}
            />
            {errors["email"] && <p className="text-xs text-destructive">{errors["email"]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Kata sandi</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={72}
              placeholder="Minimal 6 karakter"
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors["password"]}
            />
            {errors["password"] && <p className="text-xs text-destructive">{errors["password"]}</p>}
          </div>
          <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? "Memproses…" : "Masuk"}
          </Button>
          <p className="text-center text-sm">
            <Link to="/forgot-password" className="inline-flex min-h-11 items-center font-semibold text-primary">
              Lupa kata sandi?
            </Link>
          </p>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Belum punya akun?{" "}
          <Link to="/register" className="inline-flex min-h-11 items-center font-semibold text-primary">
            Daftar
          </Link>
        </p>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Data Anda tersimpan aman di server MCM
        </p>
      </div>
    </div>
  );
}
