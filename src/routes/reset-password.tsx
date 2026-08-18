import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/mcm-logo.png";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    links: canonical("/reset-password").links,
    meta: [
      ...canonical("/reset-password").meta,
      { title: "Atur kata sandi baru MCM" },
      {
        name: "description",
        content: "Buat kata sandi baru untuk akun MCM Anda setelah membuka tautan reset.",
      },
      { property: "og:title", content: "Atur kata sandi baru MCM" },
      { property: "og:description", content: "Selesaikan proses reset kata sandi akun MCM." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

const schema = z
  .object({
    password: z.string().min(8, { message: "Kata sandi minimal 8 karakter" }).max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Konfirmasi kata sandi tidak sama",
  });

type Status = "checking" | "ready" | "invalid" | "done";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setStatus("ready");
    });
    void (async () => {
      // Beri waktu klien memproses token pemulihan dari URL.
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) setStatus("ready");
      else
        setTimeout(() => {
          if (alive) setStatus((s) => (s === "checking" ? "invalid" : s));
        }, 1500);
    })();
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) {
      toast.error(
        error.message.toLowerCase().includes("same")
          ? "Kata sandi baru harus berbeda dari yang lama."
          : "Gagal menyimpan kata sandi. Coba buka ulang tautan reset.",
      );
      return;
    }
    setStatus("done");
    toast.success("Kata sandi berhasil diperbarui.");
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">
        <div className="text-center">
          <img src={logo} alt="Logo MCM" width={512} height={512} className="mx-auto size-14" />
          <h1 className="mt-3 text-2xl font-bold">Kata sandi baru</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Buat kata sandi baru untuk akun MCM Anda.
          </p>
        </div>

        {status === "checking" && (
          <div className="card-soft flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memeriksa tautan reset…
          </div>
        )}

        {status === "invalid" && (
          <div className="card-soft space-y-4 p-5 text-center">
            <p className="text-sm text-muted-foreground">
              Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru untuk melanjutkan.
            </p>
            <Button
              className="h-11 w-full rounded-xl"
              onClick={() => void navigate({ to: "/forgot-password" })}
            >
              Minta tautan baru
            </Button>
          </div>
        )}

        {status === "ready" && (
          <form className="card-soft space-y-4 p-5" onSubmit={(e) => void submit(e)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="password">Kata sandi baru</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                maxLength={72}
                placeholder="Minimal 8 karakter"
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors["password"]}
              />
              {errors["password"] && (
                <p className="text-xs text-destructive">{errors["password"]}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Ulangi kata sandi</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                maxLength={72}
                placeholder="Ketik ulang kata sandi"
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={!!errors["confirm"]}
              />
              {errors["confirm"] && <p className="text-xs text-destructive">{errors["confirm"]}</p>}
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              {loading ? "Menyimpan…" : "Simpan kata sandi"}
            </Button>
          </form>
        )}

        {status === "done" && (
          <div className="card-soft space-y-4 p-5 text-center">
            <CheckCircle2 className="mx-auto size-8 text-success" />
            <p className="text-sm text-muted-foreground">
              Kata sandi Anda sudah diperbarui dan sesi ini sudah masuk.
            </p>
            <Button
              className="h-11 w-full rounded-xl"
              onClick={() => void navigate({ to: "/chat", replace: true })}
            >
              Lanjut ke MCM
            </Button>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-semibold text-primary">
            Kembali ke halaman masuk
          </Link>
        </p>
      </div>
    </div>
  );
}
