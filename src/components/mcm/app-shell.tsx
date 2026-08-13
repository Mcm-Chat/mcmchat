import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  CircleDashed,
  ClipboardList,
  MessageCircle,
  Package,
  User,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useConversations, useLedgers } from "@/lib/api/queries";

const NAV = [
  { to: "/chat", label: "Chat", icon: MessageCircle, match: "/chat" },
  { to: "/status", label: "Status", icon: CircleDashed, match: "/status" },
  { to: "/tasks", label: "Tugas", icon: ClipboardList, match: "/tasks" },
  { to: "/catalog", label: "Katalog", icon: Package, match: "/catalog" },
  { to: "/finance", label: "Keuangan", icon: Wallet, match: "/finance" },
  { to: "/profile", label: "Profil", icon: User, match: "/profile" },
] as const;

export function BottomNavigation({
  badges,
}: {
  badges?: Partial<Record<string, number>> | undefined;
}) {
  const { user } = useAuth();
  const { data: convs } = useConversations(user?.id);
  const { data: ledgers } = useLedgers(user?.id);
  const auto: Record<string, number> = {
    "/chat": (convs ?? []).filter((c) => !c.me.is_archived).reduce((s, c) => s + c.unread, 0),
    "/finance": (ledgers ?? []).filter(
      (l) => l.status === "pending_approval" && l.counterpart_user_id === user?.id,
    ).length,
  };
  const merged = { ...auto, ...(badges ?? {}) };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="sticky bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="grid grid-cols-6">
        {NAV.map((item) => {
          const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
          const badge = merged[item.match];
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <item.icon className={cn("size-5.5", active && "stroke-[2.4]")} />
                  {!!badge && badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-destructive px-1 text-[9px] leading-4 font-bold text-destructive-foreground">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MobileHeader({
  title,
  subtitle,
  back,
  onBack,
  actions,
  variant = "solid",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode | undefined;
  back?: boolean | undefined;
  onBack?: () => void | undefined;
  actions?: ReactNode | undefined;
  variant?: "solid" | "gradient" | undefined;
  children?: ReactNode | undefined;
}) {
  const navigate = useNavigate();
  // Header memakai token global saja. Varian lama "gradient" dipertahankan di
  // tipe agar route tidak perlu diubah, tetapi tidak lagi mengubah warna —
  // seluruh menu tampil konsisten mengikuti tema akun.
  void variant;
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/60 pt-[env(safe-area-inset-top)]",
        "bg-card/95 text-foreground backdrop-blur",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        {back && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Kembali"
            className="size-11 shrink-0"
            onClick={() =>
              onBack
                ? onBack()
                : window.history.length > 1
                  ? window.history.back()
                  : navigate({ to: "/chat" })
            }
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base leading-tight font-semibold">{title}</h1>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function AppShell({
  children,
  header,
  nav = true,
  badges,
  className,
}: {
  children: ReactNode;
  header?: ReactNode | undefined;
  nav?: boolean | undefined;
  badges?: Partial<Record<string, number>> | undefined;
  className?: string | undefined;
}) {
  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background shadow-2xl sm:min-h-[100dvh]">
        {header}
        <main className={cn("flex-1 overflow-x-hidden", className)}>{children}</main>
        {nav && <BottomNavigation badges={badges} />}
      </div>
    </div>
  );
}
