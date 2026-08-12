import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Briefcase, MessageCircle, Phone, User, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/chat", label: "Chat", icon: MessageCircle, match: "/chat" },
  { to: "/calls", label: "Panggilan", icon: Phone, match: "/calls" },
  { to: "/ledger", label: "Catatan", icon: Wallet, match: "/ledger" },
  { to: "/business", label: "Bisnis", icon: Briefcase, match: "/business" },
  { to: "/profile", label: "Profil", icon: User, match: "/profile" },
] as const;

export function BottomNavigation({ badges }: { badges?: Partial<Record<string, number>> }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="sticky bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="grid grid-cols-5">
        {NAV.map((item) => {
          const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
          const badge = badges?.[item.match];
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
  subtitle?: ReactNode;
  back?: boolean;
  onBack?: () => void;
  actions?: ReactNode;
  variant?: "solid" | "gradient";
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/60 pt-[env(safe-area-inset-top)]",
        variant === "gradient" ? "app-gradient text-navy-foreground" : "bg-card/95 backdrop-blur",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        {back && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Kembali"
            className={cn("size-9 shrink-0", variant === "gradient" && "text-navy-foreground hover:bg-white/15")}
            onClick={() => (onBack ? onBack() : window.history.length > 1 ? window.history.back() : navigate({ to: "/chat" }))}
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base leading-tight font-semibold">{title}</div>
          {subtitle && (
            <div className={cn("truncate text-xs", variant === "gradient" ? "text-navy-foreground/70" : "text-muted-foreground")}>
              {subtitle}
            </div>
          )}
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
  header?: ReactNode;
  nav?: boolean;
  badges?: Partial<Record<string, number>>;
  className?: string;
}) {
  return (
    <div className="min-h-screen bg-navy/95 dark:bg-black/40">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-background shadow-2xl sm:min-h-[100dvh]">
        {header}
        <main className={cn("flex-1 overflow-x-hidden", className)}>{children}</main>
        {nav && <BottomNavigation badges={badges} />}
      </div>
    </div>
  );
}
