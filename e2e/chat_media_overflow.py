"""Regresi visual: semua jenis media chat tidak boleh meluber di berbagai lebar layar.

Menyeed satu percakapan berisi SEMUA jenis pesan (teks panjang tanpa spasi, URL
panjang, gambar, stiker, dokumen dengan nama panjang, suara, lokasi, kartu
ledger/order/produk/penjualan, balasan, reaksi) lalu membuka chat pada lebar
320 / 360 / 390 / 414 / 768 / 1024 / 1440 px dan memverifikasi:

  1. Tidak ada scroll horizontal pada dokumen maupun kontainer .chat-scroll.
  2. Setiap bubble + seluruh anak elemennya berada di dalam kotak kontainer
     (tidak melewati tepi kiri/kanan lebih dari 1px toleransi sub-pixel).
  3. Bubble tidak lebih lebar dari batas wajar (<= 88% lebar kontainer).
  4. Tidak ada error konsol/page saat merender media.

Screenshot per lebar disimpan di /tmp/browser/chat-media untuk pembanding manual.

Menjalankan: python3 e2e/chat_media_overflow.py
Butuh SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY dan
dev server di http://localhost:8080 (atur E2E_BASE_URL bila berbeda).
"""
import asyncio, os, secrets, sys, uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
import qa_admin as qa
from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
SHOTS = "/tmp/browser/chat-media"
os.makedirs(SHOTS, exist_ok=True)
RESULTS = []

WIDTHS = [320, 360, 390, 414, 768, 1024, 1440]
EDGE_TOLERANCE = 1.0      # px, toleransi pembulatan sub-pixel
MAX_BUBBLE_RATIO = 0.88   # bubble tidak boleh melebihi 88% lebar kontainer

LONG_WORD = "Pembayaran" + "SUPERPANJANGTANPASPASI" * 6
LONG_URL = ("https://katalog.mcmchat.id/produk/" + "kategori-sangat-panjang-" * 6 + "?ref=" + "x" * 80)


def record(name, status, note=""):
    RESULTS.append((name, status, note))
    print(f"[{status}] {name} {note}".rstrip())


def check(name, cond, note=""):
    record(name, "PASS" if cond else "FAIL", note)
    return bool(cond)


# ---------------------------------------------------------------- seeding
def media_rows(conv, a, b):
    base = datetime.now(timezone.utc) - timedelta(minutes=40)
    i = {"n": 0}

    def row(**kw):
        i["n"] += 1
        r = {
            "id": str(uuid.uuid4()),
            "conversation_id": conv,
            "sender_id": a if i["n"] % 2 else b,
            "kind": "text",
            "body": "",
            "created_at": (base + timedelta(minutes=i["n"])).isoformat(),
        }
        r.update(kw)
        return r

    return [
        row(body="Halo, ini pesan teks pendek."),
        row(body=LONG_WORD),
        row(body=LONG_URL),
        row(body="Teks panjang biasa. " * 25),
        row(kind="image", body="Foto barang datang",
            attachment_path="chat-media/e2e/overflow-wide.jpg",
            attachment_mime="image/jpeg", attachment_name="foto-barang-sangat-panjang-namanya.jpg",
            attachment_size=250000),
        row(kind="image", body="",
            attachment_path="chat-media/e2e/overflow-tall.jpg",
            attachment_mime="image/jpeg", attachment_name="potret.jpg", attachment_size=180000),
        row(kind="sticker", body="😀",
            attachment_path="stickers/e2e/stiker.png", attachment_mime="image/png",
            attachment_name="stiker.png", attachment_size=20000),
        row(kind="document", body="",
            attachment_path="chat-media/e2e/nota.pdf", attachment_mime="application/pdf",
            attachment_name="Nota-Pembelian-Gudang-Utama-Periode-Januari-Sampai-Desember-2026-Final-Revisi.pdf",
            attachment_size=4_500_000),
        row(kind="voice", body="", duration_sec=137,
            attachment_path="chat-media/e2e/suara.webm", attachment_mime="audio/webm",
            attachment_name="suara.webm", attachment_size=90000),
        row(kind="location", body="", location_lat=-6.2088, location_lng=106.8456,
            location_accuracy=12,
            location_label="Gudang Utama MCM, Jalan Raya Yang Namanya Sangat Panjang Sekali No. 128, Jakarta Pusat",
            location_maps_url="https://maps.google.com/?q=-6.2088,106.8456"),
        row(kind="ledger", body="Catatan utang",
            payload={"title": "Piutang " + "Pelanggan Panjang " * 4, "amount": 12750000,
                     "note": "Jatuh tempo 30 hari"}),
        row(kind="order", body="Pesanan baru",
            payload={"order_id": str(uuid.uuid4()), "status": "new"}),
        row(kind="product_card", body="",
            payload={"title": "Beras Premium Kemasan Karung Lima Puluh Kilogram Grade A",
                     "price": 685000, "unit": "karung"}),
        row(kind="sales_card", body="",
            payload={"title": "Penjualan hari ini", "total": 4325000, "items": 12}),
        row(kind="system", body="Percakapan diamankan dengan verifikasi PIN MCM."),
    ]


def seed():
    run = secrets.token_hex(4)
    pw = secrets.token_urlsafe(18)
    email_a = f"media-a-{run}@example.invalid"
    a = qa.create_user(email_a, pw)
    b = qa.create_user(f"media-b-{run}@example.invalid", pw)
    conv = str(uuid.uuid4())
    s, body = qa.rest("POST", "conversations", body={"id": conv, "type": "direct", "created_by": a})
    assert s in (200, 201), (s, body)
    for uid in (a, b):
        s, body = qa.rest("POST", "conversation_members", body={"conversation_id": conv, "user_id": uid})
        assert s in (200, 201), (s, body)
    lo, hi = sorted([a, b])
    s, body = qa.rest("POST", "direct_conversations",
                      body={"conversation_id": conv, "user_low": lo, "user_high": hi})
    assert s in (200, 201), (s, body)
    s, body = qa.rest("POST", "contact_requests",
                      body={"requester_id": a, "target_id": b, "status": "accepted"})
    assert s in (200, 201), (s, body)
    s, body = qa.rest("POST", "contact_connections", body={"user_low": lo, "user_high": hi})
    assert s in (200, 201), (s, body)
    for owner, other in ((a, b), (b, a)):
        s, body = qa.rest("POST", "contacts", body={"owner_id": owner, "contact_id": other})
        assert s in (200, 201), (s, body)

    rows = media_rows(conv, a, b)
    # PostgREST batch insert menuntut set kunci identik di semua baris.
    keys = sorted({k for r in rows for k in r})
    payload = [{k: r.get(k) for k in keys} for r in rows]
    s, body = qa.rest("POST", "messages", body=payload)
    assert s in (200, 201), (s, body)
    # Balasan terhadap pesan teks terpanjang: bubble kutipan juga wajib tidak meluber.
    quoted = rows[1]
    s, body = qa.rest("POST", "messages", body=[{
        "id": str(uuid.uuid4()), "conversation_id": conv, "sender_id": b, "kind": "text",
        "body": "Balasan untuk teks panjang tanpa spasi.", "reply_to_id": quoted["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }])
    assert s in (200, 201), (s, body)
    # Reaksi pada bubble media supaya baris reaksi ikut diukur.
    qa.rest("POST", "message_reactions", body=[
        {"message_id": rows[4]["id"], "user_id": a, "emoji": "👍"},
        {"message_id": rows[4]["id"], "user_id": b, "emoji": "😀"},
    ])
    return {"password": pw, "a": a, "b": b, "email_a": email_a, "conv": conv}


def cleanup(state):
    qa.rest("DELETE", "message_reactions", f"?user_id=in.({state['a']},{state['b']})")
    qa.rest("DELETE", "contacts", f"?owner_id=in.({state['a']},{state['b']})")
    qa.rest("DELETE", "contact_connections", f"?user_low=eq.{min(state['a'], state['b'])}")
    qa.rest("DELETE", "contact_requests", f"?requester_id=eq.{state['a']}")
    qa.rest("DELETE", "messages", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "direct_conversations", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversation_members", f"?conversation_id=eq.{state['conv']}")
    qa.rest("DELETE", "conversations", f"?id=eq.{state['conv']}")
    for uid in (state["a"], state["b"]):
        qa.delete_user(uid)


# ---------------------------------------------------------------- pengukuran
MEASURE_JS = """
(tol) => {
  const scroller = document.querySelector('.chat-scroll');
  if (!scroller) return { error: 'chat-scroll tidak ditemukan' };
  const box = scroller.getBoundingClientRect();
  const style = getComputedStyle(scroller);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const left = box.left + padL, right = box.right - padR;
  const inner = right - left;
  const bubbles = Array.from(scroller.querySelectorAll('[data-message-id]'));
  const offenders = [];
  const wide = [];
  for (const bubble of bubbles) {
    const id = bubble.getAttribute('data-message-id');
    const kind = bubble.getAttribute('data-message-kind') || '?';
    const nodes = [bubble, ...bubble.querySelectorAll('*')];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      if (r.left < left - tol || r.right > right + tol) {
        offenders.push({
          kind, id,
          tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
            ? '.' + el.className.split(/\\s+/).slice(0, 2).join('.') : ''),
          left: Math.round(r.left - left), right: Math.round(r.right - right),
          width: Math.round(r.width),
        });
      }
    }
    const br = bubble.getBoundingClientRect();
    if (br.width > inner * 0.88 + tol) wide.push({ kind, width: Math.round(br.width), inner: Math.round(inner) });
  }
  return {
    count: bubbles.length,
    kinds: [...new Set(bubbles.map((b) => b.getAttribute('data-message-kind') || '?'))],
    offenders: offenders.slice(0, 8),
    offenderTotal: offenders.length,
    wide: wide.slice(0, 6),
    scrollerOverflow: Math.round(scroller.scrollWidth - scroller.clientWidth),
    docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
}
"""


async def measure(page):
    return await page.evaluate(MEASURE_JS, EDGE_TOLERANCE)


async def run(state):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 390, "height": 900},
                                        is_mobile=True, has_touch=True)
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        await page.goto(f"{BASE}/login", wait_until="networkidle")
        await page.wait_for_selector("#email")
        await page.wait_for_timeout(1000)
        await page.fill("#email", state["email_a"])
        await page.fill("#password", state["password"])
        await page.get_by_role("button", name="Masuk").click()
        await page.wait_for_url("**/chat**", timeout=30000)

        seen_kinds = set()
        for width in WIDTHS:
            await page.set_viewport_size({"width": width, "height": 900})
            await page.goto(f"{BASE}/chat/{state['conv']}", wait_until="domcontentloaded")
            try:
                await page.wait_for_selector(".chat-scroll", timeout=25000)
            except Exception:
                await page.screenshot(path=f"{SHOTS}/w{width}-gagal.png")
                body = (await page.inner_text("body"))[:200].replace("\n", " | ")
                check(f"{width}px: halaman chat termuat", False, body)
                continue
            await page.wait_for_timeout(2500)
            # Gulir dari atas ke bawah agar semua item virtual sempat dirender & diukur.
            worst = None
            for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
                await page.evaluate(
                    "(f) => { const s = document.querySelector('.chat-scroll');"
                    " s.scrollTop = (s.scrollHeight - s.clientHeight) * f; }", frac)
                await page.wait_for_timeout(500)
                m = await measure(page)
                if m.get("error"):
                    worst = m
                    break
                seen_kinds.update(m["kinds"])
                if worst is None or m["offenderTotal"] > worst["offenderTotal"]:
                    worst = m
            await page.screenshot(path=f"{SHOTS}/w{width}.png")

            if worst.get("error"):
                check(f"{width}px: kontainer chat terukur", False, worst["error"])
                continue
            check(f"{width}px: tanpa overflow horizontal",
                  worst["scrollerOverflow"] <= 1 and worst["docOverflow"] <= 1,
                  f"scroller={worst['scrollerOverflow']}px dokumen={worst['docOverflow']}px")
            check(f"{width}px: semua media di dalam kontainer",
                  worst["offenderTotal"] == 0,
                  f"{worst['offenderTotal']} elemen meluber: " + "; ".join(
                      f"{o['kind']}/{o['tag']} L{o['left']} R{o['right']} w{o['width']}"
                      for o in worst["offenders"]) if worst["offenderTotal"] else "")
            check(f"{width}px: lebar bubble wajar (<= {int(MAX_BUBBLE_RATIO * 100)}%)",
                  not worst["wide"],
                  "; ".join(f"{w['kind']} {w['width']}/{w['inner']}" for w in worst["wide"]))

        expected = {"text", "image", "sticker", "document", "voice", "location",
                    "ledger", "order", "product_card", "sales_card"}
        missing = sorted(expected - seen_kinds)
        check("Semua jenis media ikut teruji", not missing, "belum terlihat: " + ", ".join(missing))

        fatal = [e for e in errors if "ResizeObserver" not in e and "Failed to load resource" not in e]
        check("Tanpa error konsol/page saat render media", not fatal, "; ".join(fatal[:3]))
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
