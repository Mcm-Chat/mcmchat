import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { registerDismissible } from "@/lib/a11y/escape-dismiss";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  /** Aksi tambahan di sisi kanan sebelum tombol tutup. */
  actions?: ReactNode;
  icon?: ReactNode;
  /** Bila diisi, banner menampilkan tombol tutup dan mendukung Escape. */
  onDismiss?: () => void;
  dismissLabel?: string;
  role?: "status" | "alert";
  ariaLive?: "polite" | "assertive" | "off";
  className?: string;
};

/**
 * Banner notifikasi yang konsisten: punya tombol tutup dan pintasan Escape.
 */
export function NotificationBanner({
  children,
  actions,
  icon,
  onDismiss,
  dismissLabel = "Tutup notifikasi",
  role = "status",
  ariaLive = role === "alert" ? "assertive" : "polite",
  className,
}: Props) {
  useEffect(() => {
    if (!onDismiss) return;
    return registerDismissible(onDismiss);
  }, [onDismiss]);

  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={cn("flex items-start gap-2 px-3 py-2 text-sm", className)}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {actions}
      {onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={dismissLabel}
          title={`${dismissLabel} (Esc)`}
          className="-mr-1 size-8 shrink-0 rounded-full"
          onClick={onDismiss}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
