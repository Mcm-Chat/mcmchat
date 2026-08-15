import { useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/mcm/primitives";
import { accessErrorMessage } from "@/lib/api/access-error";

/**
 * Fallback saat pembacaan chat ditolak server. Tombol "Coba lagi" hanya
 * memicu refetch React Query — tidak pernah reload penuh halaman.
 */
export function AccessFallback({
  error,
  onRetry,
  extra,
}: {
  error: unknown;
  onRetry: () => void | Promise<unknown>;
  extra?: React.ReactNode | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const { title, description } = accessErrorMessage(error);
  const retry = async () => {
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  };
  return (
    <EmptyState
      icon={ShieldAlert}
      title={title}
      description={description}
      action={
        <div className="flex flex-col items-center gap-2">
          <Button className="rounded-xl" disabled={busy} onClick={() => void retry()}>
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            {busy ? "Mencoba…" : "Coba lagi"}
          </Button>
          {extra}
        </div>
      }
    />
  );
}
