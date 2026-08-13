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
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { usePushSession } from "@/lib/push/use-push";
import { IncomingCallListener } from "@/components/mcm/incoming-call";
import { ScreenPrivacyGuard } from "@/components/mcm/screen-privacy-guard";
import { initConnectionWatcher } from "@/lib/realtime/connection";
import { initOutboxFlush } from "@/lib/api/outbox";
import { ThemeProvider, THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
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
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
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
      </head>
      <body className="bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** Sesi push dipasang sekali; tidak pernah memicu dialog izin sendiri. */
function PushSession() {
  const { user } = useAuth();
  usePushSession(user?.id);
  return null;
}

/** Cache query dibuang total saat akun berganti (termasuk logout). */
function AccountCacheGuard() {
  const client = useQueryClient();
  useEffect(() => onAccountSwitch(() => client.clear()), [client]);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Pemantau koneksi realtime + pengiriman ulang outbox dipasang sekali.
  useEffect(() => {
    const offConn = initConnectionWatcher();
    const offOutbox = initOutboxFlush();
    return () => {
      offConn();
      offOutbox();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <AccountCacheGuard />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <PushSession />
          <IncomingCallListener />
          <ScreenPrivacyGuard />
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
