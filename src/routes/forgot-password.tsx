import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/mcm-logo.png";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    links: canonical("/forgot-password").links,
    meta: [
      ...canonical("/forgot-password").meta,
      { title: "Lupa kata sandi MCM" },
      {
        name: "description",
        content: "Kirim tautan reset kata sandi ke email akun MCM Anda.",
      },
      { property: "og:title", content: "Lupa kata sandi MCM" },
      {
        property: "og:description",
        content: "Atur ulang kata sandi akun MCM lewat tautan email.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

const schema = z.string().trim().email({ message: "Masukkan email yang valid" }).max(160);

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Email tidak valid");
      return;
    }
    setError("");
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (err) {
      toast.error(
        err.message.toLowerCase().includes("rate")
          ? "Terlalu sering meminta. Coba lagi beberapa menit."
          : "Gagal mengirim tautan reset. Coba lagi.",
      );
      return;
    }
    setSent(true);
    toast.success("Tautan reset dikirim ke email Anda.");
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
        <div className="text-center">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="mx-auto size-14" />
          <h1 className="mt-3 text-2xl font-bold">Lupa kata sandi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.
          </p>
        </div>

        {sent ? (
          <div className="card-soft space-y-4 p-5 text-center">
            <MailCheck className="mx-auto size-8 text-success" />
            <p className="text-sm text-muted-foreground">
              Tautan reset sudah dikirim ke <span className="font-semibold text-foreground">{email}</span>.
              Buka email tersebut, lalu ikuti tautannya untuk membuat kata sandi baru.
            </p>
            <Button
              variant="outline"
              className="h-11 w-full rounded-xl"
              onClick={() => setSent(false)}
            >
              Kirim ulang ke email lain
            </Button>
            <Button
              className="h-11 w-full rounded-xl"
              onClick={() => void navigate({ to: "/login" })}
            >
              Kembali ke halaman masuk
            </Button>
          </div>
        ) : (
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
                aria-invalid={!!error}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Mengirim tautan…" : "Kirim tautan reset"}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary">
            <ArrowLeft className="size-4" /> Kembali masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
