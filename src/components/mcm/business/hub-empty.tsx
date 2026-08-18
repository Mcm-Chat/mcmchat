import { useState } from "react";
import { Store } from "lucide-react";
import { AppShell, MobileHeader } from "@/components/mcm/app-shell";
import { EmptyState } from "@/components/mcm/primitives";
import { Button } from "@/components/ui/button";
import { CreateBusinessDialog } from "./create-business-dialog";

/**
 * Satu empty-state untuk seluruh hub: selama pengguna belum punya bisnis,
 * segmen disembunyikan dan hanya aksi "Buat Bisnis" yang ditawarkan.
 */
export function BusinessHubEmpty({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <AppShell header={<MobileHeader title="Bisnis" />}>
      <div className="px-4 py-6">
        <EmptyState
          icon={Store}
          title="Belum punya bisnis"
          description="Buat bisnis untuk mulai mengelola katalog produk, stok gudang, dan tugas penyiapan pegawai."
          action={
            <Button className="rounded-xl" onClick={() => setOpen(true)}>
              Buat Bisnis
            </Button>
          }
        />
      </div>
      <CreateBusinessDialog open={open} onOpenChange={setOpen} userId={userId} />
    </AppShell>
  );
}
