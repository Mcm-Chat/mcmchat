import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { onAccountSwitch } from "@/lib/session-scope";
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { isPerfOverlayEnabled } from "@/lib/debug/perf-flag";
import { initConnectionWatcher } from "@/lib/realtime/connection";
import { installViewportMetrics } from "@/lib/mobile/viewport";
import { initOutboxFlush } from "@/lib/api/outbox";
import { installImportantToastFocus } from "@/lib/a11y/toast-focus";
import { installEscapeDismiss } from "@/lib/a11y/escape-dismiss";
import { ThemeProvider, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import { ReduceMotionProvider, MOTION_BOOTSTRAP_SCRIPT } from "@/lib/a11y/reduce-motion";
import { DEVICE_TIER_BOOTSTRAP_SCRIPT, installScrollPerf } from "@/lib/perf/device-tier";
import {
  installChunkRecovery,
  isChunkLoadError,
  recoverFromChunkError,
} from "@/lib/chunk-recovery";

// Modul berat/opsional dipisah dari bundel awal dan baru diunduh setelah
// aplikasi terpasang di browser (atau, untuk overlay debug, saat diaktifkan).
const RootExtrasLazy = lazy(() => import("@/components/mcm/root-extras"));
const PerfOverlayLazy = lazy(() =>
  import("@/components/mcm/perf-overlay").then((m) => ({ default: m.PerfOverlay })),
);

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    // Modul rute basi (rilis baru / sinyal putus): muat ulang otomatis.
    if (chunk && recoverFromChunkError()) return;
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, chunk]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {chunk ? "Versi aplikasi perlu dimuat ulang" : "Halaman gagal dimuat"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {chunk
            ? "Sebagian aplikasi tidak berhasil diunduh, biasanya karena ada versi baru atau koneksi terputus. Muat ulang untuk melanjutkan."
            : "Terjadi kesalahan. Coba lagi atau kembali ke beranda."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              if (chunk) {
                window.location.reload();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {chunk ? "Muat ulang" : "Coba lagi"}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ke beranda
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "MCM — Chat Privat, Panggilan & Catatan Utang" },
      {
        name: "description",
        content:
          "MCM: aplikasi komunikasi privat berbasis PIN untuk chat, panggilan, catatan utang-piutang bersama, dan alat bisnis.",
      },
      { name: "theme-color", content: "#0f1b2a" },
      {
        name: "google-site-verification",
        content: "StEYz84rl1qtnbBteGIp64am18nvMhg5C8bd43_SPu4",
      },
      { property: "og:title", content: "MCM — Chat Privat, Panggilan & Catatan Utang" },
      {
        property: "og:description",
        content: "Chat & panggilan privat berbasis PIN, catatan utang bersama, dan katalog bisnis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "MCM",
          url: "https://mcmchat.ai",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Google Search Console ownership (custom domain mcmchat.ai) */}
        <meta
          name="google-site-verification"
          content="fOepNPCGHSh_nuODqnInyJzsRPhcMRFfSecl5EsrJzE"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: DEVICE_TIER_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Cache query dibuang total saat akun berganti (termasuk logout). */
function AccountCacheGuard() {
  const client = useQueryClient();
  useEffect(() => onAccountSwitch(() => client.clear()), [client]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [mounted, setMounted] = useState(false);
  const [perf, setPerf] = useState(false);

  // Widget global dipasang setelah hidrasi supaya bundel awal tetap kecil.
  useEffect(() => {
    setMounted(true);
    setPerf(isPerfOverlayEnabled());
  }, []);

  // Pemantau koneksi realtime + pengiriman ulang outbox dipasang sekali.
  useEffect(() => {
    const offConn = initConnectionWatcher();
    const offOutbox = initOutboxFlush();
    const offViewport = installViewportMetrics();
    const offToastFocus = installImportantToastFocus();
    const offEscape = installEscapeDismiss();
    const offScrollPerf = installScrollPerf();
    const offChunk = installChunkRecovery();
    return () => {
      offConn();
      offOutbox();
      offViewport();
      offToastFocus();
      offEscape();
      offScrollPerf();
      offChunk();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ReduceMotionProvider>
          <AuthProvider>
            <AccountCacheGuard />
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
            {mounted ? (
              <Suspense fallback={null}>
                <RootExtrasLazy />
                {perf ? <PerfOverlayLazy /> : null}
              </Suspense>
            ) : null}
            <Toaster position="top-center" richColors closeButton />
          </AuthProvider>
        </ReduceMotionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
