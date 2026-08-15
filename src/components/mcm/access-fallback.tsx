import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { LifeBuoy, MessagesSquare, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/mcm/primitives";
import { accessErrorMessage } from "@/lib/api/access-error";

export type AccessRecoveryLink = "chat" | "contacts" | "support";

const RECOVERY: Record<
  AccessRecoveryLink,
  { to: string; label: string; icon: typeof LifeBuoy; search?: Record<string, never> }
> = {
  chat: { to: "/chat", label: "Kembali ke daftar chat", icon: MessagesSquare, search: {} },
  contacts: { to: "/contacts", label: "Buka daftar kontak", icon: Users },
  support: { to: "/support", label: "Hubungi admin", icon: LifeBuoy },
};

/**
 * Fallback saat pembacaan chat ditolak server. Tombol "Coba lagi" hanya
 * memicu refetch React Query, dan seluruh langkah pemulihan memakai <Link>
 * TanStack Router (navigasi soft) — tidak pernah reload penuh halaman.
 */
export function AccessFallback({
  error,
  onRetry,
  links = ["chat", "support"],
  extra,
}: {
  error: unknown;
  onRetry: () => void | Promise<unknown>;
  links?: AccessRecoveryLink[] | undefined;
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
    <div role="alert" aria-live="assertive">
    <EmptyState
      icon={ShieldAlert}
      title={title}
      description={description}
      action={
        <div className="flex w-full max-w-xs flex-col items-stretch gap-2">
          <Button className="rounded-xl" disabled={busy} onClick={() => void retry()}>
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            {busy ? "Mencoba…" : "Coba lagi"}
          </Button>
          {links.map((key) => {
            const item = RECOVERY[key];
            const Icon = item.icon;
            return (
              <Button key={key} asChild variant="ghost" className="rounded-xl">
                <Link to={item.to} {...(item.search ? { search: item.search } : {})}>
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
          {extra}
        </div>
      }
    />
    </div>
  );
}
