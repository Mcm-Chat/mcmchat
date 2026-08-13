import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { deleteMyAccount } from "@/lib/account.functions";
import { canonical } from "@/lib/site";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    links: canonical("/delete-account").links,
    meta: [
      ...canonical("/delete-account").meta,
      { title: "Hapus Akun — MCM" },
      { name: "description", content: "Hapus akun MCM Anda beserta seluruh pesan, katalog, dan catatan keuangan secara permanen." },
      { property: "og:title", content: "Hapus Akun — MCM" },
      { property: "og:description", content: "Permintaan penghapusan akun dan data MCM." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const run = useServerFn(deleteMyAccount);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setBusy(true);
    try {
      await run({});
      await signOut();
      toast.success("Akun Anda telah dihapus permanen.");
      navigate({ to: "/login", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus akun. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell nav={false} header={<MobileHeader title="Hapus akun" subtitle="Tindakan permanen" back />}>
      <div className="space-y-5 px-4 py-5 pb-10">
        <div className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">Data ini akan hilang selamanya</p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>Profil, PIN, dan daftar kontak Anda</li>
              <li>Seluruh percakapan, foto, dokumen, dan pesan suara</li>
              <li>Bisnis yang Anda miliki: katalog, stok, pesanan, penjualan</li>
              <li>Catatan utang-piutang dan riwayat pembayaran</li>
            </ul>
          </div>
        </div>

        {user ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="confirm">Ketik HAPUS untuk melanjutkan</Label>
              <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} placeholder="HAPUS" autoComplete="off" />
            </div>
            <Button variant="destructive" className="w-full" disabled={confirm !== "HAPUS" || busy} onClick={() => void onDelete()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Hapus akun saya permanen
            </Button>
            <p className="text-xs text-muted-foreground">
              Setelah dihapus, Anda tidak dapat memulihkan data ini. Anda tetap bisa mendaftar ulang dengan email yang sama, namun akan memperoleh PIN baru.
            </p>
          </>
        ) : (
          <div className="space-y-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <p>Masuk terlebih dahulu untuk menghapus akun Anda.</p>
            <Button className="w-full" onClick={() => navigate({ to: "/login" })}>
              Masuk
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
