"""Three-device / three-account live E2E for MCM.

Runs three isolated Chromium contexts (Android-like viewports) against the
same backend, with server-side database assertions via the service role.

Usage: python3 e2e/three_devices.py [stage ...]
State (including QA credentials) lives only in /tmp, never in the repo.
"""
import asyncio, json, os, sys, time, secrets
sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
SHOTS = "/tmp/browser/e2e"
os.makedirs(SHOTS, exist_ok=True)
STATE = json.load(open("/tmp/e2e-state.json"))
RUN = STATE["run"]
RESULTS = []

DEVICES = {
    "A": dict(width=360, height=800),
    "B": dict(width=390, height=844),
    "C": dict(width=411, height=891),
}
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"


def record(name, status, note=""):
    RESULTS.append({"scenario": name, "status": status, "note": note})
    print(f"[{status}] {name} {note}")


async def new_device(browser, tag):
    d = DEVICES[tag]
    ctx = await browser.new_context(
        viewport={"width": d["width"], "height": d["height"]},
        user_agent=UA, is_mobile=True, has_touch=True, device_scale_factor=2.5,
    )
    page = await ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, page, errs


async def login(page, tag, attempts=3):
    u = STATE["users"][tag]
    for i in range(attempts):
        await page.goto(BASE + "/login", wait_until="networkidle")
        await page.wait_for_selector("#email")
        await page.fill("#email", u["email"])
        await page.fill("#password", u["password"])
        await page.get_by_role("button", name="Masuk").click()
        try:
            await page.wait_for_url("**/chat**", timeout=20000)
            return
        except Exception:
            if i == attempts - 1:
                raise


async def shot(page, name):
    await page.screenshot(path=f"{SHOTS}/{name}.png")


async def stage1(pages):
    """1. Account + initial isolation."""
    ok = True
    for tag, page in pages.items():
        await page.goto(BASE + "/profile", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        body = await page.inner_text("body")
        mine = STATE["users"][tag]["pin"]
        others = [STATE["users"][t]["pin"] for t in pages if t != tag]
        if mine not in body:
            record(f"1.{tag} own PIN visible", "FAIL", "own PIN not rendered"); ok = False
        elif any(o in body for o in others):
            record(f"1.{tag} PIN isolation", "FAIL", "other account PIN leaked"); ok = False
        else:
            record(f"1.{tag} own PIN + isolation", "PASS")
        # local caches scoped to this account only
        keys = await page.evaluate("Object.keys(localStorage)")
        foreign = [k for t in pages if t != tag for k in keys if STATE["users"][t]["id"] in k]
        if foreign:
            record(f"1.{tag} localStorage scope", "FAIL", str(foreign)); ok = False
        await shot(page, f"1_profile_{tag}")
    for tag, page in pages.items():
        await page.goto(BASE + "/contacts", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        await shot(page, f"1_contacts_{tag}")
    record("1. initial isolation", "PASS" if ok else "FAIL")
    return ok


async def stage2(pages):
    """2. Contacts: request, accept, cross-account denial, block one-sidedness."""
    A, B, C = pages["A"], pages["B"], pages["C"]
    uA, uB, uC = (STATE["users"][t]["id"] for t in "ABC")
    ok = True
    await A.goto(BASE + "/contacts/add", wait_until="networkidle")
    await A.fill("#pin", STATE["users"]["C"]["pin"])
    await A.get_by_role("button", name="Cari").click()
    await A.wait_for_selector("text=Kirim permintaan", timeout=15000)
    await shot(A, "2_found_C")
    await A.get_by_role("button", name="Kirim permintaan").click()
    await A.wait_for_timeout(2000)
    reqs = qa.select("contact_requests", f"?requester_id=eq.{uA}&target_id=eq.{uC}&select=id,status")
    record("2.1 A sends contact request to C", "PASS" if reqs and reqs[0]["status"] == "pending" else "FAIL", str(reqs))
    ok &= bool(reqs)

    await C.goto(BASE + "/contacts", wait_until="networkidle")
    await C.get_by_role("tab", name="Masuk").click()
    await C.wait_for_selector("[aria-label='Terima']", timeout=15000)
    await shot(C, "2_incoming_C")
    await C.get_by_label("Terima").first.click()
    await C.wait_for_timeout(2500)
    both = qa.select("contacts", f"?or=(and(owner_id.eq.{uA},contact_id.eq.{uC}),and(owner_id.eq.{uC},contact_id.eq.{uA}))&select=owner_id,contact_id,is_blocked")
    record("2.2 C accepts -> mutual contact rows", "PASS" if len(both) == 2 else "FAIL", str(len(both)))
    ok &= len(both) == 2

    # UI shows the contact on both sides
    await A.goto(BASE + "/contacts", wait_until="networkidle")
    await A.wait_for_timeout(2500)
    aBody = await A.inner_text("body")
    cBody = await C.inner_text("body")
    seen = STATE["users"]["C"]["pin"] in aBody and STATE["users"]["A"]["pin"] in cBody
    record("2.3 both address books show each other", "PASS" if seen else "FAIL")
    ok &= seen
    await shot(A, "2_contacts_A")

    # B must not see any of it, via UI and via a direct API call on B's session
    tokB = qa.sign_in(STATE["users"]["B"]["email"], STATE["users"]["B"]["password"])
    s1, cs = qa.as_user(tokB, "GET", "/rest/v1/contacts?select=owner_id,contact_id")
    s2, rs = qa.as_user(tokB, "GET", "/rest/v1/contact_requests?select=id,requester_id,target_id")
    leak = [r for r in (cs or []) if r["owner_id"] != uB] + [r for r in (rs or []) if uB not in (r["requester_id"], r["target_id"])]
    record("2.4 B cannot read A/C contacts or requests (API)", "PASS" if not leak else "FAIL", str(leak)[:200])
    ok &= not leak
    await B.goto(BASE + "/contacts", wait_until="networkidle")
    await B.wait_for_timeout(2000)
    bBody = await B.inner_text("body")
    bleak = STATE["users"]["A"]["pin"] in bBody or STATE["users"]["C"]["pin"] in bBody
    record("2.5 B contacts UI clean", "PASS" if not bleak else "FAIL")
    ok &= not bleak
    await shot(B, "2_contacts_B")

    # A blocks C from A's book: only A's row changes
    await A.get_by_label(lambda_label := "Blokir").first.click() if False else None
    btn = A.locator("[aria-label^='Blokir ']").first
    await btn.click()
    await A.get_by_role("button", name="Blokir", exact=True).click()
    await A.wait_for_timeout(2500)
    rowA = qa.select("contacts", f"?owner_id=eq.{uA}&contact_id=eq.{uC}&select=is_blocked")
    rowC = qa.select("contacts", f"?owner_id=eq.{uC}&contact_id=eq.{uA}&select=is_blocked")
    good = rowA and rowA[0]["is_blocked"] and rowC and not rowC[0]["is_blocked"]
    record("2.6 block is one-sided (C book unchanged)", "PASS" if good else "FAIL", f"A={rowA} C={rowC}")
    ok &= bool(good)
    record("2.7 remove-contact action", "SKIP", "produk hanya menyediakan blokir, tidak ada hapus kontak")
    # unblock so later scenarios are not affected
    qa.rest("PATCH", "contacts", f"?owner_id=eq.{uA}&contact_id=eq.{uC}", {"is_blocked": False})
    record("2. contacts", "PASS" if ok else "FAIL")
    return ok


STAGES = {"1": stage1, "2": stage2}


async def main():
    wanted = sys.argv[1:] or list(STAGES)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        devs = {}
        for tag in "ABC":
            ctx, page, errs = await new_device(browser, tag)
            devs[tag] = (ctx, page, errs)
        pages = {t: d[1] for t, d in devs.items()}
        try:
            await asyncio.gather(*(login(pages[t], t) for t in pages))
            record("login A/B/C concurrent", "PASS")
            for s in wanted:
                await STAGES[s](pages)
        finally:
            for t, (ctx, page, errs) in devs.items():
                if errs:
                    print(f"console[{t}]:", json.dumps(errs[:8])[:1500])
            json.dump(RESULTS, open("/tmp/e2e-results.json", "w"), indent=1)
            await browser.close()

asyncio.run(main())
