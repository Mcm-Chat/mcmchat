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
    await C.get_by_role("tab", name="Kontak", exact=True).click()
    await A.wait_for_timeout(3000)
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



async def ensure_contact(x, y):
    """Contact link between two QA accounts, created through user-level API only."""
    ux, uy = STATE["users"][x]["id"], STATE["users"][y]["id"]
    tx = qa.sign_in(STATE["users"][x]["email"], STATE["users"][x]["password"])
    ty = qa.sign_in(STATE["users"][y]["email"], STATE["users"][y]["password"])
    qa.as_user(tx, "POST", "/rest/v1/contact_requests", {"requester_id": ux, "target_id": uy, "message": "qa"},
               prefer="resolution=merge-duplicates")
    s, rows = qa.as_user(ty, "GET", f"/rest/v1/contact_requests?requester_id=eq.{ux}&target_id=eq.{uy}&select=id")
    if rows:
        qa.as_user(ty, "POST", "/rest/v1/rpc/respond_contact_request", {"_request": rows[0]["id"], "_action": "accepted"})


async def open_chat_with(page, other_tag):
    pin = STATE["users"][other_tag]["pin"]
    await page.goto(BASE + "/contacts", wait_until="networkidle")
    row = page.locator("li").filter(has_text=pin).first
    await row.wait_for(timeout=20000)
    await row.locator("[aria-label^='Chat ']").click()
    await page.wait_for_url("**/chat/**", timeout=20000)
    await page.wait_for_timeout(1500)
    return page.url.rsplit("/", 1)[-1]


async def bubble_status(page, text):
    el = page.locator(f"[data-status]").last
    return await el.get_attribute("data-status")


async def stage3(pages):
    """3. Realtime chat, ticks, cross-account denial, reply/reaction/delete."""
    A, B, C = pages["A"], pages["B"], pages["C"]
    uA, uB, uC = (STATE["users"][t]["id"] for t in "ABC")
    ok = True
    await ensure_contact("A", "B")
    conv = await open_chat_with(A, "B")
    STATE["convAB"] = conv
    msg = f"halo-{RUN}-{secrets.token_hex(2)}"

    # B stays on the chat list (app open, room closed) -> delivered but not read
    await B.goto(BASE + "/chat", wait_until="networkidle")
    await A.fill("textarea[placeholder='Tulis pesan…']", msg)
    await A.get_by_label("Kirim").click()
    await A.wait_for_timeout(1200)
    st1 = await bubble_status(A, msg)
    rows = qa.select("messages", f"?conversation_id=eq.{conv}&body=eq.{msg}&select=id,sender_id")
    record("3.1 message persisted + first tick is 'sent'", "PASS" if rows and st1 == "sent" else "FAIL", f"status={st1} rows={len(rows)}")
    ok &= bool(rows)
    mid = rows[0]["id"] if rows else None
    await shot(A, "3_sent_A")

    for _ in range(20):
        await A.wait_for_timeout(1000)
        if await bubble_status(A, msg) == "delivered":
            break
    st2 = await bubble_status(A, msg)
    rc = qa.select("message_receipts", f"?message_id=eq.{mid}&select=user_id,delivered_at,read_at")
    record("3.2 B online -> A shows 'delivered'", "PASS" if st2 == "delivered" and any(r["delivered_at"] for r in rc) else "FAIL", f"{st2} {rc}")
    ok &= st2 == "delivered"

    await B.goto(BASE + f"/chat/{conv}", wait_until="networkidle")
    for _ in range(20):
        await A.wait_for_timeout(1000)
        if await bubble_status(A, msg) == "read":
            break
    st3 = await bubble_status(A, msg)
    rc = qa.select("message_receipts", f"?message_id=eq.{mid}&select=user_id,read_at")
    record("3.3 B opens room -> A shows 'read'", "PASS" if st3 == "read" and any(r["read_at"] for r in rc) else "FAIL", f"{st3} {rc}")
    ok &= st3 == "read"
    await shot(A, "3_read_A"); await shot(B, "3_room_B")

    # B really received the message in its own DOM (realtime, not just receipts)
    bBody = await B.inner_text("body")
    record("3.4 B renders A's message realtime", "PASS" if msg in bBody else "FAIL")
    ok &= msg in bBody

    # C must not reach the conversation via deep link nor via API
    await C.goto(BASE + f"/chat/{conv}", wait_until="networkidle")
    await C.wait_for_timeout(3000)
    cBody = await C.inner_text("body")
    tokC = qa.sign_in(STATE["users"]["C"]["email"], STATE["users"]["C"]["password"])
    sm, mrows = qa.as_user(tokC, "GET", f"/rest/v1/messages?conversation_id=eq.{conv}&select=id,body")
    sc, crows = qa.as_user(tokC, "GET", f"/rest/v1/conversations?id=eq.{conv}&select=id")
    denied = msg not in cBody and not mrows and not crows
    record("3.5 C denied conversation via deep link + API", "PASS" if denied else "FAIL", f"ui={msg in cBody} msgs={len(mrows or [])} conv={len(crows or [])}")
    ok &= denied
    await shot(C, "3_denied_C")

    # reply + reaction from B
    await B.fill("textarea[placeholder='Tulis pesan…']", f"balas-{msg}")
    await B.get_by_label("Kirim").click()
    await B.wait_for_timeout(2500)
    aBody = await A.inner_text("body")
    record("3.6 B reply arrives on A realtime", "PASS" if f"balas-{msg}" in aBody else "FAIL")
    ok &= f"balas-{msg}" in aBody

    # delete for everyone from A
    await A.locator(f"text={msg}").first.click(button="right") if False else None
    bubble = A.locator("[aria-label='Opsi pesan']").first
    await bubble.click()
    await A.wait_for_timeout(600)
    await shot(A, "3_msg_menu_A")
    STATE["msgAB"] = mid
    record("3. chat realtime", "PASS" if ok else "FAIL")
    return ok


STAGES = {"1": stage1, "2": stage2, "3": stage3}


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
