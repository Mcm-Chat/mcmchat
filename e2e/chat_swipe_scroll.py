"""E2E gestur bubble chat + kelancaran scroll (PWA mobile).

Yang diverifikasi di perangkat mobile nyata (Chromium touch, viewport 390x844):
  1. Geser KANAN pada bubble  -> composer menampilkan pratinjau "balas".
  2. Geser KIRI pada bubble    -> dialog "Teruskan pesan" terbuka.
  3. Geser VERTIKAL pada bubble tidak memicu balas/teruskan (tidak bentrok scroll).
  4. Scroll daftar pesan mulus: tidak ada frame panjang berlebih (>50ms),
     posisi scroll benar-benar berpindah, dan tidak ada error konsol.

Menjalankan: python3 e2e/chat_swipe_scroll.py
Butuh env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY
untuk seed + cleanup, dan dev server di http://localhost:8080
(atur E2E_BASE_URL bila berbeda). Kredensial hanya hidup di memori proses ini.
"""
import asyncio, os, secrets, sys, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SHOTS = "/tmp/browser/chat-swipe"
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []

MESSAGE_COUNT = 60
# Ambang jank. Dev build (React DEV + Vite HMR) selalu punya beberapa frame
# panjang saat halaman baru menempel; karena itu diukur setelah drag pemanasan,
# memakai rasio frame panjang + frame terburuk, bukan hitungan absolut.
LONG_FRAME_MS = 50          # frame > 50ms = jank kasat mata
MAX_LONG_RATIO = 0.04       # maksimal 4% frame boleh panjang
MAX_WORST_MS = 350          # tidak boleh ada frame beku > 350ms


def record(name, status, note=""):
    RESULTS.append((name, status, note))
    print(f"[{status}] {name} {note}".rstrip())


def check(name, cond, note=""):
    record(name, "PASS" if cond else "FAIL", note)
    return bool(cond)


# ---------------------------------------------------------------- seeding
def seed():
    run = secrets.token_hex(4)
    pw = secrets.token_urlsafe(18)
    email_a = f"swipe-a-{run}@example.invalid"
    a = qa.create_user(email_a, pw)
    b = qa.create_user(f"swipe-b-{run}@example.invalid", pw)
    conv = str(uuid.uuid4())
    s, body = qa.rest("POST", "conversations", body={"id": conv, "type": "direct", "created_by": a})
    assert s in (200, 201), (s, body)
    for uid in (a, b):
        s, body = qa.rest("POST", "conversation_members", body={"conversation_id": conv, "user_id": uid})
        assert s in (200, 201), (s, body)
    lo, hi = sorted([a, b])
    s, body = qa.rest("POST", "direct_conversations", body={
        "conversation_id": conv, "user_low": lo, "user_high": hi,
    })
    assert s in (200, 201), (s, body)
    # Relasi kontak harus "accepted", jika tidak composer diganti banner
    # "Terima percakapan & hubungkan" dan pratinjau balas tidak pernah muncul.
    s, body = qa.rest("POST", "contact_requests", body={
        "requester_id": a, "target_id": b, "status": "accepted",
    })
    assert s in (200, 201), (s, body)
    s, body = qa.rest("POST", "contact_connections", body={
        "user_low": lo, "user_high": hi,
    })
    assert s in (200, 201), (s, body)
    for owner, other in ((a, b), (b, a)):
        s, body = qa.rest("POST", "contacts", body={"owner_id": owner, "contact_id": other})
        assert s in (200, 201), (s, body)
    base = datetime.now(timezone.utc) - timedelta(minutes=MESSAGE_COUNT + 5)
    rows = []
    for i in range(MESSAGE_COUNT):
        rows.append({
            "id": str(uuid.uuid4()),
            "conversation_id": conv,
            "sender_id": b if i % 2 else a,
            "kind": "text",
            "body": f"Pesan uji nomor {i + 1}",
            "created_at": (base + timedelta(minutes=i)).isoformat(),
        })
    s, body = qa.rest("POST", "messages", body=rows)
    assert s in (200, 201), (s, body)
    return {"password": pw, "a": a, "b": b, "email_a": email_a, "conv": conv}


def cleanup(state):
    qa.rest("DELETE", "contacts", f"?owner_id=in.({state['a']},{state['b']})")
    qa.rest("DELETE", "contact_connections", f"?user_low=eq.{min(state['a'], state['b'])}")
    qa.rest("DELETE", "contact_requests", f"?requester_id=eq.{state['a']}")
    qa.rest("DELETE", "messages", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "direct_conversations", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversation_members", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversations", f"?id=eq.{state['conv']}")
    for uid in (state["a"], state["b"]):
        qa.delete_user(uid)


# ---------------------------------------------------------------- gestur
async def touch_drag(cdp, x, y, dx, dy, steps=12, hold_ms=12):
    """Drag jari sungguhan lewat CDP (Playwright touchscreen hanya mendukung tap)."""
    await cdp.send("Input.dispatchTouchEvent", {
        "type": "touchStart", "touchPoints": [{"x": x, "y": y}],
    })
    for i in range(1, steps + 1):
        await cdp.send("Input.dispatchTouchEvent", {
            "type": "touchMove",
            "touchPoints": [{"x": x + dx * i / steps, "y": y + dy * i / steps}],
        })
        await asyncio.sleep(hold_ms / 1000)
    await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


async def bubble_box(page, text):
    loc = page.get_by_text(text, exact=True).last
    await loc.scroll_into_view_if_needed()
    await page.wait_for_timeout(250)
    return await loc.bounding_box()


# ---------------------------------------------------------------- main
async def run(state):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
        )
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        cdp = await ctx.new_cdp_session(page)

        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector("#email")
        await page.wait_for_timeout(1200)
        await page.fill("#email", state["email_a"])
        await page.fill("#password", state["password"])
        await page.get_by_role("button", name="Masuk").click()
        await page.wait_for_url("**/chat**", timeout=30000)

        await page.goto(f"{BASE}/chat/{state['conv']}", wait_until="domcontentloaded")
        await page.wait_for_selector(".chat-scroll", timeout=20000)
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f"{SHOTS}/0_chat.png")

        target = f"Pesan uji nomor {MESSAGE_COUNT}"
        box = await bubble_box(page, target)
        if not check("Bubble target terlihat", box is not None, target):
            await browser.close()
            return

        # --- 1. geser kanan = balas
        await touch_drag(cdp, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, 150, 0)
        reply = page.get_by_test_id("reply-preview")
        try:
            await reply.wait_for(state="visible", timeout=5000)
        except Exception:
            pass
        ok = await reply.count() > 0
        check("Geser kanan membuka pratinjau balas", ok)
        await page.screenshot(path=f"{SHOTS}/1_reply.png")
        if await reply.count() > 0:
            await reply.get_by_role("button", name="Batal").click()
            await reply.wait_for(state="detached", timeout=5000)

        # --- 2. geser kiri = teruskan
        box = await bubble_box(page, target)
        await touch_drag(cdp, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, -150, 0)
        dialog = page.get_by_role("dialog")
        try:
            await dialog.first.wait_for(state="visible", timeout=5000)
        except Exception:
            pass
        fwd = await dialog.count() > 0 and "Teruskan" in (await dialog.first.inner_text())
        check("Geser kiri membuka dialog Teruskan", fwd)
        await page.screenshot(path=f"{SHOTS}/2_forward.png")
        if fwd:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(400)

        # --- 3. geser vertikal tidak memicu aksi
        box = await bubble_box(page, target)
        await touch_drag(cdp, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, 8, -220)
        await page.wait_for_timeout(500)
        no_reply = await page.get_by_test_id("reply-preview").count() == 0
        no_dialog = await page.get_by_role("dialog").count() == 0
        check("Geser vertikal tidak memicu balas/teruskan", no_reply and no_dialog,
              f"reply={not no_reply} dialog={not no_dialog}")

        # --- 4. kelancaran scroll
        # Drag pemanasan: memicu fetch pesan lama + kompilasi lazy chunk supaya
        # pengukuran benar-benar mengukur scroll, bukan cold start.
        await touch_drag(cdp, 195, 620, 0, -300, steps=12, hold_ms=8)
        await page.wait_for_timeout(1200)
        await page.evaluate(
            """() => {
              window.__frames = [];
              let last = performance.now();
              const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
              requestAnimationFrame(tick);
            }"""
        )
        before = await page.evaluate("document.querySelector('.chat-scroll').scrollTop")
        for _ in range(6):
            await touch_drag(cdp, 195, 620, 0, -320, steps=16, hold_ms=8)
            await asyncio.sleep(0.12)
        for _ in range(4):
            await touch_drag(cdp, 195, 300, 0, 320, steps=16, hold_ms=8)
            await asyncio.sleep(0.12)
        await page.wait_for_timeout(600)
        after = await page.evaluate("document.querySelector('.chat-scroll').scrollTop")
        stats = await page.evaluate(
            f"""() => {{
              const f = (window.__frames || []).slice(3);
              const sorted = [...f].sort((a, b) => a - b);
              const long = f.filter((d) => d > {LONG_FRAME_MS});
              return {{
                total: f.length,
                long: long.length,
                p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] || 0),
                worst: Math.round(Math.max(0, ...f)),
              }};
            }}"""
        )
        ratio = stats["long"] / max(1, stats["total"])
        check("Scroll benar-benar bergerak", abs(after - before) > 100,
              f"scrollTop {before} -> {after}")
        check("Scroll mulus (rasio frame panjang & frame terburuk)",
              ratio <= MAX_LONG_RATIO and stats["worst"] <= MAX_WORST_MS,
              f"panjang={stats['long']}/{stats['total']} ({ratio * 100:.1f}%) "
              f"p95={stats['p95']}ms terburuk={stats['worst']}ms")
        await page.screenshot(path=f"{SHOTS}/3_scroll.png")

        fatal = [e for e in errors if "ResizeObserver" not in e]
        check("Tanpa error konsol/page", not fatal, "; ".join(fatal[:3]))
        await browser.close()


def main():
    state = seed()
    try:
        asyncio.run(run(state))
    finally:
        cleanup(state)
    failed = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} PASS — screenshot di {SHOTS}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
