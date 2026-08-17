"""E2E aksesibilitas lightbox foto (PhotoViewer) di chat.

Diverifikasi:
  1. Lightbox terbuka dari bubble foto dan fokus awal jatuh ke tombol "Tutup".
  2. Focus trap: Tab dan Shift+Tab berulang tidak pernah keluar dari dialog.
  3. Sisa halaman di-inert (tidak terjangkau pembaca layar/tab).
  4. Esc menutup lightbox dan fokus kembali ke bubble foto pemicu.
  5. Tombol "Tutup" bisa dipicu dari keyboard (Enter dan Space).
  6. Kontrol zoom mengumumkan level lewat live region role="status".

Menjalankan: python3 e2e/photo_viewer_a11y.py
Butuh SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dan dev server di
http://localhost:8080 (atur E2E_BASE_URL bila berbeda).
"""
import asyncio, io, os, secrets, sys, urllib.request, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SHOTS = "/tmp/browser/photo-viewer-a11y"
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []
TAB_LIMIT = 12
BUCKET = "chat-media"
# Policy storage chat-media memakai prefix folder = id percakapan.
PHOTO_PATH = ""


def upload_photo(conv):
    """Unggah JPEG kecil sungguhan supaya bubble foto benar-benar bisa dibuka."""
    global PHOTO_PATH
    PHOTO_PATH = f"{conv}/{secrets.token_hex(6)}.jpg"
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (32, 96, 160)).save(buf, format="JPEG")
    req = urllib.request.Request(
        f"{qa.URL}/storage/v1/object/{BUCKET}/{PHOTO_PATH}",
        data=buf.getvalue(),
        headers={"apikey": qa.KEY, "Authorization": "Bearer " + qa.KEY,
                 "Content-Type": "image/jpeg", "x-upsert": "true"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        assert r.status in (200, 201), r.status


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
    email_a = f"pv-a-{run}@example.invalid"
    a = qa.create_user(email_a, pw)
    b = qa.create_user(f"pv-b-{run}@example.invalid", pw)
    conv = str(uuid.uuid4())
    s, body = qa.rest("POST", "conversations", body={"id": conv, "type": "direct", "created_by": a})
    assert s in (200, 201), (s, body)
    for uid in (a, b):
        s, body = qa.rest("POST", "conversation_members",
                          body={"conversation_id": conv, "user_id": uid})
        assert s in (200, 201), (s, body)
    lo, hi = sorted([a, b])
    s, body = qa.rest("POST", "direct_conversations",
                      body={"conversation_id": conv, "user_low": lo, "user_high": hi})
    assert s in (200, 201), (s, body)
    qa.rest("POST", "contact_requests",
            body={"requester_id": a, "target_id": b, "status": "accepted"})
    qa.rest("POST", "contact_connections", body={"user_low": lo, "user_high": hi})
    for owner, other in ((a, b), (b, a)):
        qa.rest("POST", "contacts", body={"owner_id": owner, "contact_id": other})
    upload_photo(conv)
    now = datetime.now(timezone.utc)
    s, body = qa.rest("POST", "messages", body=[{
        "id": str(uuid.uuid4()), "conversation_id": conv, "sender_id": b,
        "kind": "image", "body": "Foto uji aksesibilitas",
        "attachment_path": PHOTO_PATH,
        "attachment_mime": "image/jpeg", "attachment_name": "a11y-photo.jpg",
        "attachment_size": 120000,
        "created_at": (now - timedelta(minutes=2)).isoformat(),
    }])
    assert s in (200, 201), (s, body)
    return {"password": pw, "a": a, "b": b, "email_a": email_a, "conv": conv}


def cleanup(state):
    qa._req("DELETE", f"/storage/v1/object/{BUCKET}/{PHOTO_PATH}")
    lo, hi = sorted([state["a"], state["b"]])
    qa.rest("DELETE", "contacts", f"?owner_id=in.({state['a']},{state['b']})")
    qa.rest("DELETE", "contact_connections", f"?user_low=eq.{lo}&user_high=eq.{hi}")
    qa.rest("DELETE", "contact_requests", f"?requester_id=eq.{state['a']}")
    qa.rest("DELETE", "messages", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "direct_conversations", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversation_members", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversations", f"?id=eq.{state['conv']}")
    for uid in (state["a"], state["b"]):
        qa.delete_user(uid)


# ---------------------------------------------------------------- helpers
FOCUS_JS = """() => {
  const el = document.activeElement;
  if (!el) return null;
  return {
    tag: el.tagName.toLowerCase(),
    label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 48),
    inDialog: Boolean(el.closest('[role="dialog"][aria-modal="true"]')),
  };
}"""


async def focus_info(page):
    return await page.evaluate(FOCUS_JS)


async def tab_cycle(page, shift=False):
    seen = []
    key = "Shift+Tab" if shift else "Tab"
    for _ in range(TAB_LIMIT):
        await page.keyboard.press(key)
        info = await focus_info(page)
        seen.append(info)
        if not info or not info["inDialog"]:
            return False, seen
    return True, seen


async def open_viewer(page, trigger):
    await trigger.click()
    await page.wait_for_selector('[role="dialog"][aria-modal="true"]', timeout=10000)
    await page.wait_for_timeout(350)


# ---------------------------------------------------------------- main
async def run(state):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                        is_mobile=True, has_touch=True,
                                        service_workers="block")
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        http_errors = []
        page.on("response", lambda r: http_errors.append(f"{r.status} {r.url}")
                if r.status >= 400 else None)

        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector("#email")
        await page.wait_for_timeout(1200)
        await page.fill("#email", state["email_a"])
        await page.fill("#password", state["password"])
        await page.get_by_role("button", name="Masuk").click()
        await page.wait_for_url("**/chat**", timeout=30000)

        await page.goto(f"{BASE}/chat/{state['conv']}", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f"{SHOTS}/0_chat.png")

        trigger = page.locator('[data-message-kind="image"] button[aria-label]').first
        if await trigger.count() == 0:
            record("Bubble foto tersedia", "FAIL", "tombol foto tidak ditemukan")
            await browser.close()
            return
        record("Bubble foto tersedia", "PASS")

        # --- 1. Fokus awal
        await open_viewer(page, trigger)
        info = await focus_info(page)
        check("Fokus awal di tombol Tutup",
              info is not None and "Tutup" in (info["label"] or ""), f"fokus di: {info}")

        # --- 2. Focus trap (maju & mundur)
        trapped, seen = await tab_cycle(page)
        check("Focus trap: Tab tidak keluar dialog", trapped,
              "" if trapped else f"fokus lolos: {seen[-1]}")
        trapped_back, seen_back = await tab_cycle(page, shift=True)
        check("Focus trap: Shift+Tab tidak keluar dialog", trapped_back,
              "" if trapped_back else f"fokus lolos: {seen_back[-1]}")

        # --- 3. Sisa halaman inert
        inert_ok = await page.evaluate(
            """() => {
              const dlg = document.querySelector('[role="dialog"][aria-modal="true"]');
              return Array.from(document.body.children).every(
                (el) => el.contains(dlg) || el.hasAttribute('inert'));
            }"""
        )
        check("Sisa halaman di-inert saat lightbox terbuka", inert_ok)

        # --- 6. Pengumuman zoom (live region)
        await page.get_by_role("button", name="Perbesar foto").click()
        await page.wait_for_timeout(300)
        live = (await page.locator('[role="status"][aria-live="polite"]').first.inner_text()).strip()
        check("Live region mengumumkan level zoom", "Zoom" in live and "persen" in live, live)
        await page.screenshot(path=f"{SHOTS}/1_open.png")

        # --- 4. Esc menutup + fokus kembali ke pemicu
        await page.keyboard.press("Escape")
        await page.wait_for_selector('[role="dialog"][aria-modal="true"]', state="detached",
                                     timeout=10000)
        await page.wait_for_timeout(350)
        back = await page.evaluate("(el) => document.activeElement === el",
                                   await trigger.element_handle())
        check("Esc menutup lightbox + fokus kembali ke bubble foto", bool(back),
              f"fokus di: {await focus_info(page)}")
        restored = await page.evaluate(
            "() => Array.from(document.body.children).every((el) => !el.hasAttribute('inert'))")
        check("Inert dilepas setelah lightbox tertutup", restored)

        # --- 5. Tombol Tutup lewat keyboard (Enter lalu Space)
        for key in ("Enter", "Space"):
            await open_viewer(page, trigger)
            info = await focus_info(page)
            ok_focus = info is not None and "Tutup" in (info["label"] or "")
            await page.keyboard.press(key)
            closed = True
            try:
                await page.wait_for_selector('[role="dialog"][aria-modal="true"]',
                                             state="detached", timeout=5000)
            except Exception:
                closed = False
            check(f"Tombol Tutup dapat dipicu dengan {key}", ok_focus and closed,
                  f"fokus awal: {info}")
            await page.wait_for_timeout(250)

        real_errors = [e for e in errors if "favicon" not in e.lower()]
        check("Tidak ada error konsol", not real_errors, str(real_errors[:3]))
        check("Tidak ada respons HTTP >=400", not http_errors, str(http_errors[:5]))
        await browser.close()


def main():
    state = seed()
    try:
        asyncio.run(run(state))
    finally:
        cleanup(state)
    failed = [r for r in RESULTS if r[1] != "PASS"]
    print("\n=== RINGKASAN ===")
    for name, status, note in RESULTS:
        print(f"{status:4} | {name} {note}".rstrip())
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} lulus")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
