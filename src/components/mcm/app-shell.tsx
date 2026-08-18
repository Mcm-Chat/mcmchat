import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  MessageCircle,
  Phone,
  Store,
  User,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useCalls, useConversations, useLedgers } from "@/lib/api/queries";
import { useIncomingCallActive } from "@/lib/calls/incoming-lock";
import { isMissedUnseen, useMissedCallsSeen } from "@/lib/calls/missed-seen";

const NAV = [
  { to: "/chat", label: "Chat", icon: MessageCircle, match: "/chat" },
  { to: "/calls", label: "Panggilan", icon: Phone, match: "/calls" },
  { to: "/finance", label: "Catatan", icon: Wallet, match: "/finance" },
  { to: "/business", label: "Bisnis", icon: Store, match: "/business" },
  { to: "/profile", label: "Profil", icon: User, match: "/profile" },
] as const;

export function BottomNavigation({
  badges,
}: {
  badges?: Partial<Record<string, number>> | undefined;
}) {
  const { user } = useAuth();
  const navRef = useRef<HTMLElement>(null);
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
  const router = useRouter();
  // Di ponsel tidak ada hover: sentuhan pertama pada tab langsung memicu
  // pengunduhan rute tujuan, jadi saat jari diangkat halaman sudah siap.
  const prefetch = (to: string) => {
    if (callLocked) return;
    void router.preloadRoute({ to }).catch(() => {});
  };
  // Tinggi nyata bar (termasuk safe-area/keyboard) diekspor sebagai
  // --mcm-nav-h agar area scroll bisa menyisakan ruang dan konten terakhir
  // tidak pernah tertutup bar di perangkat ber-notch.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>("[data-app-shell]") ?? document.documentElement;
    const sync = () => root.style.setProperty("--mcm-nav-h", `${Math.round(el.offsetHeight)}px`);
    sync();
    const ro = new ResizeObserver(sync);
    // border-box: perubahan padding safe-area/keyboard ikut terpantau.
    ro.observe(el, { box: "border-box" });
    window.addEventListener("orientationchange", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", sync);
      root.style.removeProperty("--mcm-nav-h");
    };
  }, []);
  return (
    <>
      {callLocked && (
        <p role="status" aria-live="polite" className="sr-only">
          Navigasi dinonaktifkan sementara. Jawab atau tolak panggilan masuk lebih dulu.
        </p>
      )}
      <nav
        ref={navRef}
        aria-label="Navigasi utama"
        aria-hidden={callLocked ? "true" : undefined}
        data-locked={callLocked ? "" : undefined}
        className={cn(
          "sticky bottom-0 z-30 shrink-0 border-t border-border bg-card/95 backdrop-blur",
          // Ruang aman: inset bawah dibatasi 2rem supaya bar tidak tumbuh
          // berlebihan, dan diabaikan saat keyboard membuka (var --mcm-kb).
          "pb-[max(min(env(safe-area-inset-bottom,0px),2rem),var(--mcm-kb,0px))]",
          // Bar tidak boleh ikut menggulung/melebar di layar ber-notch.
          "max-w-full overflow-x-clip overscroll-contain [contain:paint]",
          callLocked && "pointer-events-none opacity-40 select-none",
        )}
      >
        <ul className="grid w-full grid-cols-5">
          {NAV.map((item) => {
            const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
            const badge = merged[item.match];
            const badgeText =
              badge && badge > 0 ? `, ${badge > 99 ? "lebih dari 99" : badge} item baru` : "";
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  preload="intent"
                  onPointerDown={() => prefetch(item.to)}
                  onTouchStart={() => prefetch(item.to)}
                  onFocus={() => prefetch(item.to)}
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
                    "relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors",
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
                  <span aria-hidden="true" className="max-w-full truncate px-0.5">
                    {item.label}
                  </span>
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
      <div className="flex items-center gap-1 px-4 py-2.5">
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
          <h1 className="screen-title truncate">{title}</h1>
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
      <div
        data-app-shell
        className="mx-auto flex h-full w-full max-w-md flex-col overflow-hidden bg-background pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] shadow-2xl"
      >
        {header}
        <main
          className={cn(
            "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain",
            // Elemen mengambang / konten terakhir tetap terjangkau di atas bar.
            nav && "scroll-pb-[var(--mcm-nav-h,0px)]",
            className,
          )}
        >
          {children}
        </main>
        {nav && <BottomNavigation badges={badges} />}
      </div>
    </div>
  );
}
