import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ClipboardList,
  MessageCircle,
  Package,
  Phone,
  User,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useCalls, useConversations, useLedgers } from "@/lib/api/queries";
import { useIncomingCallActive } from "@/lib/calls/incoming-lock";
import { isMissedUnseen, useMissedCallsSeen } from "@/lib/calls/missed-seen";

const NAV = [
  { to: "/chat", label: "Chat", icon: MessageCircle, match: "/chat" },
  { to: "/calls", label: "Panggilan", icon: Phone, match: "/calls" },
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
  const { data: calls } = useCalls(user?.id);
  const missedSeen = useMissedCallsSeen();
  const auto: Record<string, number> = {
    "/chat": (convs ?? []).filter((c) => !c.me.is_archived).reduce((s, c) => s + c.unread, 0),
    "/calls": (calls ?? []).filter(
      (c) => c.status === "missed" && c.initiator_id !== user?.id && isMissedUnseen(missedSeen, c),
    ).length,
    "/finance": (ledgers ?? []).filter(
      (l) => l.status === "pending_approval" && l.counterpart_user_id === user?.id,
    ).length,
  };
  const merged = { ...auto, ...(badges ?? {}) };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Saat panggilan masuk berdering, navigasi bawah dinonaktifkan total:
  // tidak bisa ditekan, tidak bisa di-Tab, dan disembunyikan dari pembaca
  // layar — agar fokus tetap pada tombol Jawab/Tolak.
  const callLocked = useIncomingCallActive();
  return (
    <>
      {callLocked && (
        <p role="status" aria-live="polite" className="sr-only">
          Navigasi dinonaktifkan sementara. Jawab atau tolak panggilan masuk lebih dulu.
        </p>
      )}
      <nav
        aria-label="Navigasi utama"
        aria-hidden={callLocked ? "true" : undefined}
        data-locked={callLocked ? "" : undefined}
        className={cn(
          "sticky bottom-0 z-30 shrink-0 border-t border-border bg-card/95 pb-[max(env(safe-area-inset-bottom),var(--mcm-kb,0px))] backdrop-blur",
          callLocked && "pointer-events-none opacity-40 select-none",
        )}
      >
        <ul className="grid grid-cols-6">
          {NAV.map((item) => {
            const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
            const badge = merged[item.match];
            const badgeText =
              badge && badge > 0 ? `, ${badge > 99 ? "lebih dari 99" : badge} item baru` : "";
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  tabIndex={callLocked ? -1 : 0}
                  aria-disabled={callLocked ? "true" : undefined}
                  onClick={(e) => {
                    if (callLocked) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  aria-label={`${item.label}${badgeText}${active ? " (halaman aktif)" : ""}`}
                  className={cn(
                    "relative flex min-h-12 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none focus-visible:rounded-xl",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="relative">
                    <item.icon
                      aria-hidden="true"
                      className={cn("size-5.5", active && "stroke-[2.4]")}
                    />
                    {!!badge && badge > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-destructive px-1 text-[9px] leading-4 font-bold text-destructive-foreground"
                      >
                        {badge > 99 ? "99+" : badge}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
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
        "sticky top-0 z-30 shrink-0 border-b border-border/60 pt-[env(safe-area-inset-top)]",
        "bg-card/95 text-foreground backdrop-blur",
      )}
    >
      <div className="flex items-center gap-1 px-3 py-2.5">
        {back && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Kembali"
            className="size-10 shrink-0"
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
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
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
    <div className="h-dvh bg-muted/40">
      <div className="mx-auto flex h-full w-full max-w-md flex-col overflow-hidden bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-2xl">
        {header}
        <main className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto", className)}>
          {children}
        </main>
        {nav && <BottomNavigation badges={badges} />}
      </div>
    </div>
  );
}
