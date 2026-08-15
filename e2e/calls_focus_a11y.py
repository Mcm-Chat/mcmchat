"""E2E aksesibilitas halaman Panggilan: urutan fokus + tombol Escape pada 3 modal.

Modal yang diuji:
  1. Dialog "Panggilan baru"                  -> fokus awal ke kolom pencarian
  2. Sheet aksi cepat panggilan tak terjawab  -> fokus awal ke "Balas suara"
  3. AlertDialog "Penyedia panggilan belum terhubung" -> fokus awal ke "Mengerti"

Untuk setiap modal diverifikasi: fokus awal, focus trap saat Tab berulang,
Escape menutup modal, dan fokus kembali ke tombol pemicu.

Menjalankan: python3 e2e/calls_focus_a11y.py
Butuh env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (seed + cleanup) dan dev
server di http://localhost:8080. Kredensial hanya hidup di memori proses ini.
"""
import asyncio, os, secrets, sys, uuid

sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SHOTS = "/tmp/browser/calls-a11y"
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []
TAB_LIMIT = 14


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
    a = qa.create_user(f"a11y-a-{run}@example.invalid", pw)
    b = qa.create_user(f"a11y-b-{run}@example.invalid", pw)
    conv = str(uuid.uuid4())
    s, body = qa.rest("POST", "conversations", body={
        "id": conv, "type": "direct", "created_by": a,
    })
    assert s in (200, 201), (s, body)
    for uid in (a, b):
        s, body = qa.rest("POST", "conversation_members", body={"conversation_id": conv, "user_id": uid})
        assert s in (200, 201), (s, body)
    lo, hi = sorted([a, b])
    s, body = qa.rest("POST", "direct_conversations", body={
        "conversation_id": conv, "user_low": lo, "user_high": hi,
    })
    assert s in (200, 201), (s, body)
    call = str(uuid.uuid4())
    s, body = qa.rest("POST", "calls", body={
        "id": call, "conversation_id": conv, "initiator_id": b,
        "kind": "audio", "status": "missed", "provider": "livekit",
    })
    assert s in (200, 201), (s, body)
    for uid in (a, b):
        s, body = qa.rest("POST", "call_participants", body={"call_id": call, "user_id": uid})
        assert s in (200, 201), (s, body)
    return {"run": run, "password": pw, "a": a, "b": b,
            "email_a": f"a11y-a-{run}@example.invalid", "conv": conv, "call": call}


def cleanup(state):
    qa.rest("DELETE", "call_participants", f"?call_id=eq.{state['call']}")
    qa.rest("DELETE", "calls", f"?id=eq.{state['call']}")
    qa.rest("DELETE", "direct_conversations", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversation_members", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversations", f"?id=eq.{state['conv']}")
    for uid in (state["a"], state["b"]):
        qa.delete_user(uid)


# ---------------------------------------------------------------- helpers
async def focus_info(page):
    return await page.evaluate(
        """() => {
          const el = document.activeElement;
          if (!el) return null;
          const dlg = el.closest('[role="dialog"],[role="alertdialog"]');
          return {
            tag: el.tagName.toLowerCase(),
            label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.textContent || '').trim().slice(0, 40),
            inModal: Boolean(dlg),
          };
        }"""
    )


async def tab_cycle(page, steps=TAB_LIMIT):
    """Tab berulang; kembalikan True bila fokus tidak pernah keluar dari modal."""
    seen = []
    for _ in range(steps):
        await page.keyboard.press("Tab")
        info = await focus_info(page)
        seen.append(info)
        if not info or not info["inModal"]:
            return False, seen
    return True, seen


async def modal_case(page, label, open_fn, trigger_locator, expect_focus, dialog_role="dialog"):
    await trigger_locator.wait_for(state="visible", timeout=15000)
    await open_fn()
    await page.wait_for_selector(f'[role="{dialog_role}"][data-state="open"]', timeout=10000)
    await page.wait_for_timeout(400)
    info = await focus_info(page)
    check(f"{label}: fokus awal", info is not None and expect_focus(info),
          f"fokus di: {info}")
    trapped, seen = await tab_cycle(page)
    check(f"{label}: focus trap Tab", trapped,
          "" if trapped else f"fokus lolos keluar modal: {seen[-1]}")
    await page.screenshot(path=f"{SHOTS}/{label.replace(' ', '_')}.png")
    await page.keyboard.press("Escape")
    await page.wait_for_selector(f'[role="{dialog_role}"]', state="detached", timeout=10000)
    await page.wait_for_timeout(350)
    after = await focus_info(page)
    expected = (await trigger_locator.get_attribute("aria-label")) or (await trigger_locator.inner_text()).strip()
    same = await page.evaluate(
        "(el) => document.activeElement === el", await trigger_locator.element_handle()
    )
    check(f"{label}: Escape menutup + fokus kembali ke pemicu", bool(same),
          f"diharapkan '{expected}', fokus di: {after}")


# ---------------------------------------------------------------- main
async def run(state):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        # Modal 3 butuh penyedia panggilan "belum terhubung": paksa lewat
        # intersepsi respons server function getCallConfig.
        unconfigured = {"on": False, "hit": False}

        async def route_config(route):
            req = route.request
            if unconfigured["on"] and "getCallConfig" in req.url:
                unconfigured["hit"] = True
                await route.fulfill(status=200, content_type="application/json",
                                    body='{"provider":"livekit","configured":false,"code":"missing_env"}')
            else:
                await route.continue_()

        await page.route("**/_serverFn/**", route_config)

        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector("#email")
        await page.wait_for_timeout(1500)
        await page.fill("#email", state["email_a"])
        await page.fill("#password", state["password"])
        await page.get_by_role("button", name="Masuk").click()
        await page.wait_for_url("**/chat**", timeout=30000)

        await page.goto(f"{BASE}/calls", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f"{SHOTS}/0_calls.png")

        # --- Modal 1: Dialog "Panggilan baru"
        new_call = page.get_by_role("button", name="Panggilan baru")
        await modal_case(
            page, "Dialog Panggilan baru",
            lambda: new_call.click(),
            new_call,
            lambda i: i["label"] == "Cari kontak atau grup",
        )

        # --- Modal 2: Sheet aksi cepat panggilan tak terjawab
        quick = page.get_by_role("button", name="Aksi cepat panggilan tak terjawab").first
        if await quick.count() == 0:
            record("Sheet panggilan tak terjawab", "FAIL", "entri panggilan tak terjawab tidak muncul")
        else:
            await modal_case(
                page, "Sheet panggilan tak terjawab",
                lambda: quick.click(),
                quick,
                lambda i: "Balas suara" in (i["label"] or ""),
            )

        # --- Modal 3: AlertDialog penyedia belum terhubung
        unconfigured["on"] = True
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        new_call = page.get_by_role("button", name="Panggilan baru")
        await new_call.click()
        await page.wait_for_selector('[role="dialog"][data-state="open"]', timeout=10000)
        voice = page.get_by_role("button", name="Panggilan suara ke").first
        if await voice.count() == 0:
            record("AlertDialog penyedia belum terhubung", "FAIL", "tidak ada target panggilan")
        else:
            await voice.click()
            await page.wait_for_selector('[role="alertdialog"]', timeout=10000)
            await page.wait_for_timeout(400)
            info = await focus_info(page)
            check("AlertDialog penyedia: fokus awal aman (Mengerti)",
                  info is not None and "Mengerti" in (info["label"] or ""), f"fokus di: {info}")
            trapped, seen = await tab_cycle(page, 8)
            check("AlertDialog penyedia: focus trap Tab", trapped,
                  "" if trapped else f"fokus lolos: {seen[-1]}")
            await page.screenshot(path=f"{SHOTS}/alertdialog.png")
            await page.keyboard.press("Escape")
            await page.wait_for_selector('[role="alertdialog"]', state="detached", timeout=10000)
            check("AlertDialog penyedia: Escape menutup", True)
            check("Intersepsi getCallConfig aktif", unconfigured["hit"])

        real_errors = [e for e in errors if "favicon" not in e.lower()]
        check("Tidak ada error konsol", not real_errors, str(real_errors[:3]))
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
