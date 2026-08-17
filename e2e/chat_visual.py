"""Regresi visual (screenshot) tampilan chat di 360 / 768 / 1440 px.

Berbeda dengan `chat_media_overflow.py` (mengukur geometri), skrip ini
membandingkan piksel tangkapan layar dengan baseline tersimpan di
`e2e/__screenshots__/chat/`, sehingga overflow *dan* misalignment halus
(pergeseran padding, avatar, meta waktu, tombol aksi) langsung ketahuan.

Determinisme:
  * jam sistem halaman dibekukan (Date.now tetap) dan pesan diseed dengan
    stempel waktu relatif terhadap jam beku itu,
  * nama profil, isi pesan, dan urutan pesan tetap,
  * animasi/transisi/caret dimatikan lewat CSS,
  * media yang butuh signed URL memang tampil sebagai skeleton/fallback tetap.

Menjalankan:
  python3 e2e/chat_visual.py            # bandingkan dengan baseline
  python3 e2e/chat_visual.py --update   # tulis ulang baseline

Butuh SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY dan
dev server di http://localhost:8080 (atur E2E_BASE_URL bila berbeda).
"""
import asyncio, os, secrets, sys, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from PIL import Image, ImageChops
from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
BASELINE_DIR = os.path.join(os.path.dirname(__file__), "__screenshots__", "chat")
OUT = "/tmp/browser/chat-visual"
os.makedirs(BASELINE_DIR, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

UPDATE = "--update" in sys.argv
WIDTHS = [("mobile", 360, 780), ("tablet", 768, 900), ("desktop", 1440, 900)]
# Ambang: <=0.20% piksel berbeda dianggap noise render (antialias teks/emoji).
MAX_DIFF_RATIO = 0.0020
PIXEL_TOLERANCE = 24  # selisih kanal warna yang masih dianggap sama

# Jam beku: semua label waktu ("09:30", "2 jam lalu") jadi deterministik.
FROZEN = datetime(2026, 5, 4, 3, 0, 0, tzinfo=timezone.utc)  # 10:00 WIB
FROZEN_MS = int(FROZEN.timestamp() * 1000)

RESULTS = []


def record(name, status, note=""):
    RESULTS.append((name, status, note))
    print(f"[{status}] {name} {note}".rstrip())


def check(name, cond, note=""):
    record(name, "PASS" if cond else "FAIL", note)
    return bool(cond)


# ---------------------------------------------------------------- seeding
def rows_for(conv, a, b):
    i = {"n": 0}

    def row(minutes_ago, **kw):
        i["n"] += 1
        r = {
            "id": str(uuid.uuid4()),
            "conversation_id": conv,
            "sender_id": a if i["n"] % 2 else b,
            "kind": "text",
            "body": "",
            "created_at": (FROZEN - timedelta(minutes=minutes_ago)).isoformat(),
        }
        r.update(kw)
        return r

    return [
        row(60, body="Halo, stok beras premium masih ada?"),
        row(58, body="Ada, sisa 128 karung di Gudang Utama. Saya kirim rinciannya ya."),
        row(56, kind="image", body="Foto barang datang",
            attachment_path="chat-media/e2e/visual-wide.jpg", attachment_mime="image/jpeg",
            attachment_name="foto-barang.jpg", attachment_size=250000),
        row(54, kind="document", body="",
            attachment_path="chat-media/e2e/nota.pdf", attachment_mime="application/pdf",
            attachment_name="Nota-Pembelian-Gudang-Utama-Januari-2026.pdf", attachment_size=4500000),
        row(52, kind="voice", body="", duration_sec=42,
            attachment_path="chat-media/e2e/suara.webm", attachment_mime="audio/webm",
            attachment_name="suara.webm", attachment_size=90000),
        row(50, kind="location", body="", location_lat=-6.2088, location_lng=106.8456,
            location_accuracy=12, location_label="Gudang Utama MCM, Jakarta Pusat",
            location_maps_url="https://maps.google.com/?q=-6.2088,106.8456"),
        row(48, kind="product_card", body="Beras Premium",
            payload={"productName": "Beras Premium Karung 50 kg", "variantName": "Karung 50 kg",
                     "price": 685000, "unit": "karung", "perUnitQty": 50, "perUnitUnit": "kg",
                     "stockLabel": "128 karung di Gudang Utama", "availableUnitCount": 128,
                     "photos": []}),
        row(46, kind="sales_card", body="Rincian penjualan",
            payload={"number": "INV-2026-000128", "total": 4325000, "paid": 2000000,
                     "outstanding": 2325000, "paymentMethod": "dp",
                     "note": "Sisa dibayar akhir bulan",
                     "items": [{"name": "Beras Premium", "variantName": "Karung 50 kg",
                                "unit": "karung", "qty": 5, "price": 685000,
                                "discount": 0, "photos": []}]}),
        row(44, kind="ledger", body="Piutang Toko Sinar Jaya Rp2.325.000"),
        row(42, body="Baik, saya transfer DP hari ini."),
        row(40, kind="system", body="Percakapan diamankan dengan verifikasi PIN MCM."),
    ]


def seed():
    run = secrets.token_hex(4)
    pw = secrets.token_urlsafe(18)
    email_a = f"visual-a-{run}@example.invalid"
    a = qa.create_user(email_a, pw)
    b = qa.create_user(f"visual-b-{run}@example.invalid", pw)
    # Nama profil tetap supaya header & avatar inisial deterministik.
    for uid, name in ((a, "Ace Toko Utama"), (b, "Sinar Jaya")):
        qa.rest("PATCH", "profiles", f"?id=eq.{uid}", body={"display_name": name})
    conv = str(uuid.uuid4())
    s, body = qa.rest("POST", "conversations", body={"id": conv, "type": "direct", "created_by": a})
    assert s in (200, 201), (s, body)
    for uid in (a, b):
        s, body = qa.rest("POST", "conversation_members",
                          body={"conversation_id": conv, "user_id": uid})
        assert s in (200, 201), (s, body)
    lo, hi = sorted([a, b])
    for table, payload in (
        ("direct_conversations", {"conversation_id": conv, "user_low": lo, "user_high": hi}),
        ("contact_requests", {"requester_id": a, "target_id": b, "status": "accepted"}),
        ("contact_connections", {"user_low": lo, "user_high": hi}),
        ("contacts", {"owner_id": a, "contact_id": b}),
        ("contacts", {"owner_id": b, "contact_id": a}),
    ):
        s, body = qa.rest("POST", table, body=payload)
        assert s in (200, 201), (table, s, body)

    rows = rows_for(conv, a, b)
    keys = sorted({k for r in rows for k in r})
    s, body = qa.rest("POST", "messages", body=[{k: r.get(k) for k in keys} for r in rows])
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


# ---------------------------------------------------------------- stabilisasi
FREEZE_CLOCK = """
(fixed) => {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  // eslint-disable-next-line no-global-assign
  window.Date = FrozenDate;
}
"""

STABLE_CSS = """
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
.animate-pulse { animation: none !important; opacity: 1 !important; }
html { scrollbar-width: none; }
::-webkit-scrollbar { display: none; }
"""


# ---------------------------------------------------------------- pembanding
def compare(name, shot_path):
    baseline = os.path.join(BASELINE_DIR, f"{name}.png")
    if UPDATE or not os.path.exists(baseline):
        Image.open(shot_path).save(baseline)
        record(f"{name}: baseline ditulis", "PASS", os.path.basename(baseline))
        return
    a = Image.open(baseline).convert("RGB")
    b = Image.open(shot_path).convert("RGB")
    if a.size != b.size:
        check(f"{name}: ukuran tangkapan sama", False, f"baseline={a.size} sekarang={b.size}")
        return
    diff = ImageChops.difference(a, b).convert("L").point(
        lambda v: 255 if v > PIXEL_TOLERANCE else 0)
    changed = sum(diff.histogram()[1:])
    total = a.size[0] * a.size[1]
    ratio = changed / total
    if ratio > MAX_DIFF_RATIO:
        diff_path = os.path.join(OUT, f"{name}-diff.png")
        diff.save(diff_path)
        bbox = diff.getbbox()
        check(f"{name}: cocok dengan baseline", False,
              f"{ratio * 100:.2f}% piksel berbeda (bbox={bbox}) → {diff_path}")
    else:
        check(f"{name}: cocok dengan baseline", True, f"{ratio * 100:.3f}% piksel berbeda")


# ---------------------------------------------------------------- run
async def capture(page, name, width, height):
    path = os.path.join(OUT, f"{name}.png")
    await page.screenshot(path=path, clip={"x": 0, "y": 0, "width": width, "height": height})
    compare(name, path)


async def run(state):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True, args=["--force-color-profile=srgb", "--font-render-hinting=none",
                                 "--disable-lcd-text", "--hide-scrollbars"])
        for label, width, height in WIDTHS:
            ctx = await browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1, locale="id-ID",
                timezone_id="Asia/Jakarta", reduced_motion="reduce",
                is_mobile=width < 768, has_touch=width < 768)
            await ctx.add_init_script(FREEZE_CLOCK, FROZEN_MS)
            page = await ctx.new_page()
            try:
                await page.goto(f"{BASE}/login", wait_until="networkidle")
                await page.wait_for_selector("#email")
                await page.fill("#email", state["email_a"])
                await page.fill("#password", state["password"])
                await page.get_by_role("button", name="Masuk").click()
                await page.wait_for_url("**/chat**", timeout=30000)
                await page.add_style_tag(content=STABLE_CSS)
                await page.wait_for_timeout(2500)
                await capture(page, f"chat-list-{label}", width, height)

                await page.goto(f"{BASE}/chat/{state['conv']}", wait_until="domcontentloaded")
                await page.wait_for_selector(".chat-scroll", timeout=25000)
                await page.add_style_tag(content=STABLE_CSS)
                await page.wait_for_timeout(3000)
                # Posisi gulir tetap di bawah (pesan terbaru) agar frame stabil.
                await page.evaluate(
                    "() => { const s = document.querySelector('.chat-scroll');"
                    " s.scrollTop = s.scrollHeight; }")
                await page.wait_for_timeout(1200)
                await page.evaluate("() => document.activeElement && document.activeElement.blur()")
                await capture(page, f"chat-room-{label}", width, height)
            except Exception as e:  # noqa: BLE001
                await page.screenshot(path=os.path.join(OUT, f"gagal-{label}.png"))
                check(f"{label}: tangkapan chat berhasil", False, str(e)[:180])
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
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} PASS — "
          f"baseline: {BASELINE_DIR}, keluaran: {OUT}")
    if failed and not UPDATE:
        print("Bila perubahan tampilan memang disengaja, perbarui baseline: "
              "bun run test:e2e:chat-visual:update")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
