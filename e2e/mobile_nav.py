"""Uji E2E singkat: navigasi mobile antar rute utama tanpa error.

Memeriksa tiap tab navigasi bawah (Chat, Panggilan, Tugas/Catatan, Katalog,
Keuangan, Profil) plus rute Bisnis pada viewport 390x844:
  * URL berpindah tanpa reload penuh (SPA soft navigation),
  * konten utama ter-render (bukan layar kosong / fallback error),
  * tidak ada error konsol maupun pageerror selama navigasi.

Butuh SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY dan
dev server di http://localhost:8080 (atur E2E_BASE_URL bila berbeda).

Jalankan: python3 e2e/mobile_nav.py
"""
import asyncio, os, secrets, sys

sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
OUT = "/tmp/browser/mobile-nav"
os.makedirs(OUT, exist_ok=True)

# (label tab, path yang diharapkan)
TABS = [
    ("Chat", "/chat"),
    ("Panggilan", "/calls"),
    ("Tugas", "/tasks"),
    ("Katalog", "/catalog"),
    ("Keuangan", "/finance"),
    ("Profil", "/profile"),
]
# Rute Bisnis sengaja mengalihkan ke Katalog: (label, path, path akhir).
EXTRA_ROUTES = [("Bisnis", "/business", "/catalog")]

# Noise yang tidak menandakan kegagalan navigasi.
IGNORE = ("favicon", "manifest.json", "firebase", "messaging", "service worker",
          "ServiceWorker", "notification", "Download the React DevTools",
          "WebSocket", "realtime", "permissions policy", "Permissions-Policy")

RESULTS = []


def record(name, status, note=""):
    RESULTS.append((name, status, note))
    print(f"[{status}] {name} {note}".rstrip())


def check(name, cond, note=""):
    record(name, "PASS" if cond else "FAIL", note)
    return bool(cond)


def seed():
    run = secrets.token_hex(4)
    pw = secrets.token_urlsafe(18)
    email = f"nav-{run}@example.invalid"
    uid = qa.create_user(email, pw)
    qa.rest("PATCH", "profiles", f"?id=eq.{uid}", body={"display_name": "Ace Nav Test"})
    return {"uid": uid, "email": email, "password": pw}


def cleanup(state):
    qa.delete_user(state["uid"])


async def run(state):
    errors = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                        locale="id-ID", timezone_id="Asia/Jakarta",
                                        is_mobile=True, has_touch=True,
                                        service_workers="block")
        page = await ctx.new_page()

        def on_console(msg):
            if msg.type == "error" and not any(k in msg.text for k in IGNORE):
                errors.append(f"console: {msg.text[:200]}")

        page.on("console", on_console)
        page.on("response", lambda r: (r.status >= 400 and print("HTTP", r.status, r.url[:200])))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:200]}"))

        try:
            await page.goto(f"{BASE}/login", wait_until="networkidle")
            await page.wait_for_selector("#email", timeout=30000)
            await page.fill("#email", state["email"])
            await page.fill("#password", state["password"])
            await page.wait_for_timeout(400)
            if not await page.input_value("#email"):
                await page.fill("#email", state["email"])
                await page.fill("#password", state["password"])
            await page.get_by_role("button", name="Masuk").click()
            await page.wait_for_url("**/chat**", timeout=30000)
            check("login berhasil", True, page.url)

            # Tandai dokumen: kalau navigasi memicu reload penuh, penanda hilang.
            await page.evaluate("() => { window.__navMark = 'spa'; }")

            for label, path in TABS:
                before = len(errors)
                nav = page.get_by_role("navigation", name="Navigasi utama")
                await nav.get_by_role("link", name=label, exact=False).first.click()
                await page.wait_for_url(f"**{path}**", timeout=20000)
                await page.wait_for_timeout(900)
                await page.wait_for_selector("main", timeout=20000)
                mark = await page.evaluate("() => window.__navMark || null")
                body_len = await page.evaluate(
                    "() => (document.querySelector('main')?.innerText || '').trim().length")
                crashed = await page.evaluate(
                    "() => !!document.body.innerText.match(/Terjadi kesalahan|Something went wrong/i)")
                ok = (path in page.url and mark == "spa" and body_len > 0
                      and not crashed and len(errors) == before)
                await page.screenshot(path=os.path.join(OUT, f"{path.strip('/')}.png"))
                check(f"tab {label} ({path})", ok,
                      f"url={page.url} spa={mark == 'spa'} teks={body_len} "
                      f"error={errors[before:] or 'tidak ada'}")

            for label, path, final in EXTRA_ROUTES:
                before = len(errors)
                await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
                await page.wait_for_selector("main", timeout=20000)
                await page.wait_for_timeout(900)
                body_len = await page.evaluate(
                    "() => (document.querySelector('main')?.innerText || '').trim().length")
                await page.screenshot(path=os.path.join(OUT, f"{path.strip('/')}.png"))
                check(f"rute {label} ({path} → {final})", final in page.url and body_len > 0
                      and len(errors) == before,
                      f"url={page.url} teks={body_len} error={errors[before:] or 'tidak ada'}")
        except Exception as e:  # noqa: BLE001
            await page.screenshot(path=os.path.join(OUT, "gagal.png"))
            check("navigasi mobile selesai", False, str(e)[:200])
        finally:
            await ctx.close()
            await browser.close()


def main():
    state = seed()
    try:
        asyncio.run(run(state))
    finally:
        cleanup(state)
    failed = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} PASS — tangkapan: {OUT}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
