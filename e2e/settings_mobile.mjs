/** Mocked browser regression, never a physical Android/push-delivery result.
 * Install Playwright outside the app if desired. Run with:
 * TOKOLINK_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
 * TOKOLINK_CHROMIUM_EXECUTABLE=/path/to/chromium node e2e/settings_mobile.mjs
 * Browser requests to Supabase are intercepted; other external traffic is blocked.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { chromium } = await import(process.env.TOKOLINK_PLAYWRIGHT_MODULE ?? "playwright");
const port = 8086;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import { createServer } from 'vite';
     const server = await createServer({
       server: {host:'127.0.0.1',port:${port},strictPort:true},
       optimizeDeps: {entries:['src/router.tsx'],include:['@tanstack/react-query','@supabase/supabase-js']}
     });
     await server.listen();`,
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      // Fixture-only child-process values; never edit the repository's .env files.
      VITE_SUPABASE_URL: "https://settings-test.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_settings_test",
      SUPABASE_URL: "https://settings-test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_settings_test",
      SUPABASE_SERVICE_ROLE_KEY: "qa-server-fixture-never-valid",
      LOVABLE_API_KEY: "local-qa-placeholder",
    },
    stdio: "ignore",
  },
);
let browser;
const uid = "11111111-1111-4111-8111-111111111111";
const stamp = () => new Date().toISOString();
let settings = {
  user_id: uid,
  theme: "dark",
  notifications: {
    push: true,
    preview: true,
    sound: true,
    vibrate: true,
    chat: true,
    group: true,
    calls: true,
    tasks: true,
    sales: true,
    ledger: true,
    badge: true,
  },
  privacy: { online: true, readReceipts: true },
  security: { appLock: false, twoFactor: false },
  voice: {},
  created_at: stamp(),
  updated_at: stamp(),
};
const storageKeys = ["sb-settings-test-auth-token"];
const results = [];
try {
  for (let i = 0; i < 60; i++) {
    try {
      if (
        (await fetch(`${origin}/settings/notifications`, { signal: AbortSignal.timeout(3000) })).ok
      )
        break;
    } catch {
      /* Wait for compilation. */
    }
    if (i === 59) throw new Error("Local QA server did not become ready.");
    await delay(500);
  }
  const launch = () =>
    chromium.launch({
      headless: true,
      ...(process.env.TOKOLINK_CHROMIUM_EXECUTABLE
        ? {
            executablePath: process.env.TOKOLINK_CHROMIUM_EXECUTABLE,
            args: [
              "--no-sandbox",
              "--disable-dev-shm-usage",
              "--no-zygote",
              "--single-process",
              "--disable-gpu",
            ],
          }
        : {}),
    });
  for (const [width, fontScale] of [
    [320, 1],
    [411, 1],
    [411, 1.25],
  ]) {
    browser = await launch();
    const context = await browser.newContext({
      viewport: { width, height: 891 },
      isMobile: true,
      hasTouch: true,
      locale: "id-ID",
      serviceWorkers: "block",
    });
    await context.addInitScript(
      ({ uid, keys, origin }) => {
        if (location.origin !== origin) return;
        const user = {
          id: uid,
          aud: "authenticated",
          role: "authenticated",
          email: "qa@example.invalid",
          created_at: new Date().toISOString(),
        };
        const payload = btoa(
          JSON.stringify({
            sub: uid,
            role: "authenticated",
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        );
        for (const key of keys)
          localStorage.setItem(
            key,
            JSON.stringify({
              access_token: `e30.${payload}.test`,
              refresh_token: "test-refresh",
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              expires_in: 3600,
              token_type: "bearer",
              user,
            }),
          );
      },
      { uid, keys: [...storageKeys], origin },
    );
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.hostname !== "settings-test.supabase.co") return route.abort();
      let body = [];
      if (url.pathname.includes("/user_settings")) body = settings;
      if (url.pathname.endsWith("/rpc/my_profile"))
        body = {
          id: uid,
          display_name: "Akun Uji TOKOLINK",
          pin: "123456",
          bio: "",
          phone: "",
          avatar_url: null,
          avatar_privacy: "contacts",
          avatar_version: 1,
        };
      if (url.pathname.endsWith("/rpc/my_pin")) body = "123456";
      if (url.pathname.endsWith("/rpc/update_my_settings")) {
        const patch = route.request().postDataJSON()._patch;
        settings = Object.fromEntries(
          Object.entries({ ...settings, ...patch }).map(([key, value]) => [
            key,
            patch[key] && typeof patch[key] === "object" ? { ...settings[key], ...value } : value,
          ]),
        );
        settings.updated_at = stamp();
        body = settings;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    // Realtime uses WebSocket and is not covered by HTTP route interception.
    // Permit only local Vite HMR; these UI checks require no external realtime server.
    await context.routeWebSocket("**/*", (socket) => {
      if (new URL(socket.url()).origin === `ws://127.0.0.1:${port}`) socket.connectToServer();
      else socket.close();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const path of [
      "/profile",
      "/settings/notifications",
      "/settings/voice",
      "/settings/calls",
      "/settings/push-test",
    ]) {
      await page.goto(`${origin}${path}`);
      if (path === "/settings/notifications")
        await page.getByRole("switch", { name: "Aktifkan notifikasi push", exact: true }).waitFor();
      if (path === "/profile")
        await page.getByRole("heading", { name: "Tampilan & privasi" }).waitFor();
      if (path === "/settings/voice")
        await page.getByRole("button", { name: "Simpan preferensi" }).waitFor();
      await page.locator("main").waitFor();
      if (path === "/settings/notifications") {
        const preview = page.getByRole("switch", { name: "Pratinjau isi pesan", exact: true });
        const next = (await preview.getAttribute("aria-checked")) !== "true";
        await preview.click();
        await page.waitForFunction(
          (desired) =>
            document
              .querySelector('[role=switch][aria-label="Pratinjau isi pesan"]')
              ?.getAttribute("aria-checked") === String(desired),
          next,
        );
        assert.equal(
          settings.notifications.preview,
          next,
          "Preview change must be persisted by the mocked RPC",
        );
      }
      if (path === "/profile") {
        const theme = page.getByRole("switch", { name: "Mode gelap", exact: true });
        const next = (await theme.getAttribute("aria-checked")) !== "true";
        await theme.click();
        await page.waitForFunction(
          (desired) => document.documentElement.classList.contains("dark") === desired,
          next,
        );
        assert.equal(
          settings.theme,
          next ? "dark" : "light",
          "Theme change must be persisted by the mocked RPC",
        );
      }
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, fontScale);
      assert.match(await page.title(), /TOKOLINK/);
      const dimensions = await page.evaluate(() => {
        const main = document.querySelector("main");
        return {
          width: innerWidth,
          body: document.body.scrollWidth,
          main: main.scrollWidth,
          client: main.clientWidth,
        };
      });
      assert.ok(
        dimensions.body <= dimensions.width + 1,
        `${path}: document overflow ${JSON.stringify(dimensions)}`,
      );
      assert.ok(
        dimensions.main <= dimensions.client + 1,
        `${path}: main overflow ${JSON.stringify(dimensions)}`,
      );
      assert.equal(await page.getByText("This page didn't load").count(), 0);
      results.push({ path, width, fontScale, result: "pass" });
    }
    assert.deepEqual(errors, [], "Unexpected browser runtime errors");
    await context.close();
    await browser.close();
    browser = undefined;
  }
  console.log(
    JSON.stringify(
      {
        kind: "mocked Chromium mobile viewport regression; Android unverified",
        checks: results.length,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill();
}
