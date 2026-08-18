import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/** Pesan error ramah di bawah field input. */
export function FieldError({
  id,
  message,
}: {
  id?: string | undefined;
  message?: string | null | undefined;
}) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-[12px] leading-4 text-destructive">
      {message}
    </p>
  );
}

/** State error seragam untuk semua daftar: penjelasan + tombol coba lagi. */
export function ListErrorState({
  title = "Gagal memuat data",
  description = "Periksa koneksi Anda lalu coba lagi.",
  onRetry,
  retrying = false,
  action,
}: {
  title?: string;
  description?: string;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  action?: ReactNode | undefined;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-xs flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <div className="space-y-1.5">
        <p className="text-[15px] font-semibold tracking-[-0.01em]">{title}</p>
        <p className="text-[13px] leading-5 text-balance text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {onRetry && (
          <Button variant="outline" className="rounded-xl" disabled={retrying} onClick={onRetry}>
            <RefreshCw className={cn("size-4", retrying && "animate-spin")} />
            {retrying ? "Memuat…" : "Coba lagi"}
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}

export function MCMAvatar({
  initials,
  color,
  size = "md",
  online,
  emoji,
  className,
}: {
  initials: string;
  color: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | undefined;
  online?: boolean | undefined;
  emoji?: string | undefined;
  className?: string | undefined;
}) {
  const sizes = {
    xs: "size-8 text-[11px]",
    sm: "size-10 text-xs",
    md: "size-12 text-sm",
    lg: "size-16 text-lg",
    xl: "size-24 text-2xl",
  };
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white",
          sizes[size],
          color,
        )}
      >
        {emoji ?? initials}
      </div>
      {online && (
        <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-background bg-success" />
      )}
    </div>
  );
}

const toneStyles = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground dark:text-warning",
  danger: "bg-destructive/12 text-destructive",
  navy: "bg-navy/10 text-navy dark:bg-navy-foreground/10 dark:text-navy-foreground",
} as const;

export type Tone = keyof typeof toneStyles;

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneStyles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon | ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border/60 bg-primary/10 text-primary">
        <Icon className="size-7" />
      </div>
      <div className="space-y-1.5">
        <p className="text-[15px] font-semibold tracking-[-0.01em]">{title}</p>
        <p className="text-[13px] leading-5 text-balance text-muted-foreground">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function LoadingSkeleton({
  rows = 5,
  avatar = true,
}: {
  rows?: number | undefined;
  avatar?: boolean;
}) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          {avatar && <Skeleton className="size-12 rounded-full" />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Lanjutkan",
  cancelLabel = "Batal",
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  destructive?: boolean | undefined;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[340px] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row justify-end gap-2">
          <AlertDialogCancel className="mt-0">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : ""
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SettingRow({
  icon: Icon,
  label,
  description,
  right,
  onClick,
}: {
  icon?: LucideIcon | undefined;
  label: string;
  description?: string | undefined;
  right?: ReactNode | undefined;
  onClick?: () => void | undefined;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left",
        onClick && "transition-colors hover:bg-muted/60 active:bg-muted",
      )}
    >
      {Icon && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
      {right}
    </Comp>
  );
}

export function ProtoNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-muted/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

export function ActionButton({
  icon: Icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "default" | "danger" | undefined;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-auto flex-col gap-1.5 rounded-xl px-2 py-3 text-[11px] font-medium",
        tone === "danger" && "text-destructive hover:text-destructive",
      )}
    >
      <Icon className="size-5" />
      {label}
    </Button>
  );
}
