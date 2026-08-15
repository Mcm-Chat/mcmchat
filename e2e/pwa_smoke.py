#!/usr/bin/env python3
"""Smoke test PWA mobile-first (Playwright).

Tujuan: memastikan shell aplikasi, rute publik utama, metadata PWA, dan
navigasi klien tidak rusak. Sengaja TIDAK memerlukan kredensial backend
apa pun supaya bisa jadi gate wajib di CI pada setiap PR.

Jalankan: bun run test:e2e:pwa   (server dev harus hidup di BASE_URL)
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080").rstrip("/")
OUT = os.environ.get("E2E_ARTIFACTS", "/tmp/browser/pwa-smoke")
VIEWPORT = {"width": 390, "height": 844}  # iPhone 14 / patokan mobile-first

# Rute publik: harus bisa dirender tanpa sesi login.
PUBLIC_ROUTES = [
    ("/", "layar masuk"),
    ("/login", "masuk"),
    ("/register", "daftar"),
    ("/onboarding", "pengenalan"),
    ("/privacy", "kebijakan privasi"),
    ("/terms", "syarat"),
    ("/support", "bantuan"),
    ("/download", "unduh aplikasi"),
    ("/delete-account", "hapus akun"),
]

# Pesan konsol yang tidak menandakan kerusakan aplikasi.
CONSOLE_ALLOWLIST = (
    "Download the React DevTools",
    "[vite]",
    "Failed to load resource: net::ERR_",  # jaringan eksternal (font) di runner tanpa egress
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "supabase",  # backend tidak dipakai pada rute publik; kegagalan auth bukan target smoke
)

results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((ok, name, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{(' ' + detail) if detail else ''}", flush=True)
    return ok


def relevant(text: str) -> bool:
    return not any(a in text for a in CONSOLE_ALLOWLIST)


async def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=3,
            is_mobile=True,
            has_touch=True,
            user_agent=(
                "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            ),
        )
        page = await context.new_page()

        console_errors: list[str] = []
        page_errors: list[str] = []
        bad_responses: list[str] = []
        page.on(
            "console",
            lambda m: console_errors.append(m.text) if m.type == "error" and relevant(m.text) else None,
        )
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        def on_response(r):
            if r.url.startswith(BASE) and r.status >= 400 and relevant(r.url):
                bad_responses.append(f"{r.status} {r.url}")

        page.on("response", on_response)

        # --- 1. manifest PWA
        api = context.request
        mres = await api.get(f"{BASE}/manifest.webmanifest")
        check("Manifest dapat diambil", mres.status == 200, f"status={mres.status}")
        manifest = {}
        try:
            manifest = json.loads(await mres.text())
        except Exception as exc:  # pragma: no cover - hanya untuk pesan gagal
            check("Manifest berupa JSON valid", False, str(exc))
        else:
            check("Manifest berupa JSON valid", True)
        check(
            "Manifest siap dipasang (name/start_url/display/icons)",
            bool(manifest.get("name"))
            and manifest.get("start_url") == "/"
            and manifest.get("display") == "standalone"
            and len(manifest.get("icons") or []) > 0,
            f"display={manifest.get('display')} ikon={len(manifest.get('icons') or [])}",
        )
        icon_status = []
        for icon in manifest.get("icons") or []:
            r = await api.get(BASE + icon["src"])
            icon_status.append(f"{icon['src']}={r.status}")
        check(
            "Semua ikon manifest tersedia",
            all(s.endswith("=200") for s in icon_status),
            ", ".join(icon_status),
        )

        # --- 2. rute publik dapat dirender di viewport mobile
        for path, label in PUBLIC_ROUTES:
            resp = await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            status = resp.status if resp else 0
            await page.wait_for_timeout(400)
            body = (await page.inner_text("body")).strip()
            crashed = any(
                marker in body
                for marker in ("Unexpected Application Error", "Application Error", "404 Not Found")
            )
            check(
                f"Rute {path} ({label}) tampil",
                status < 400 and len(body) > 20 and not crashed,
                f"status={status} teks={len(body)} char",
            )
            overflow = await page.evaluate(
                "() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)"
                " - document.documentElement.clientWidth"
            )
            check(f"Rute {path} tanpa scroll horizontal", overflow <= 1, f"lebih {overflow}px")

        # --- 3. metadata head untuk pemasangan di layar utama
        head = await page.evaluate(
            """() => ({
              manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') || '',
              apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') || '',
              icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || '',
              viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
              title: document.title,
            })"""
        )
        check(
            "Head memuat manifest + ikon layar utama",
            head["manifest"].endswith("manifest.webmanifest")
            and bool(head["apple"])
            and bool(head["icon"]),
            f"manifest={head['manifest']} apple={head['apple']}",
        )
        check(
            "Meta viewport responsif",
            "width=device-width" in head["viewport"],
            head["viewport"],
        )
        check("Judul halaman terisi", len(head["title"]) > 5, head["title"])

        # --- 4. navigasi klien (SPA) tidak memuat ulang halaman penuh
        await page.goto(f"{BASE}/login", wait_until="domcontentloaded")
        await page.wait_for_timeout(500)
        await page.evaluate("() => { window.__spa = 'alive'; }")
        link = page.get_by_role("link", name="Daftar").first
        if await link.count() == 0:
            link = page.locator('a[href="/register"]').first
        await link.click()
        await page.wait_for_url("**/register", timeout=10000)
        await page.wait_for_timeout(400)
        still_alive = await page.evaluate("() => window.__spa === 'alive'")
        check("Navigasi /login → /register berjalan", page.url.endswith("/register"), page.url)
        check("Navigasi memakai router klien (tanpa reload penuh)", bool(still_alive))

        # --- 5. tombol kembali perangkat
        await page.go_back()
        await page.wait_for_timeout(600)
        check("Tombol kembali kembali ke /login", page.url.rstrip("/").endswith("/login"), page.url)

        await page.screenshot(path=f"{OUT}/login.png")

        # --- 6. tidak ada error runtime
        check("Tanpa error JavaScript", not page_errors, "; ".join(page_errors[:3]))
        check("Tanpa error konsol", not console_errors, "; ".join(console_errors[:3]))
        check("Tanpa respons 4xx/5xx dari aplikasi", not bad_responses, "; ".join(bad_responses[:5]))

        await browser.close()

    passed = sum(1 for ok, _, _ in results if ok)
    print(f"{passed}/{len(results)} PASS — screenshot di {OUT}", flush=True)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
