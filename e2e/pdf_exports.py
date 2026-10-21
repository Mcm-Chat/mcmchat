"""Offline PDF browser/raster parity; build first with:
node --experimental-strip-types scripts/build-pdf-regression.ts
Then: python3 e2e/pdf_exports.py
Needs Chromium (Playwright) and pdftoppm. No credentials or backend access.
"""
import asyncio
import base64
import functools
import hashlib
import http.server
import json
import os
import shutil
from pathlib import Path
import subprocess
import threading
from playwright.async_api import async_playwright

ROOT = Path(os.getenv("PDF_BROWSER_OUTPUT", "/tmp/mcm-pdf-browser"))

async def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    results = {}
    production = Path(__file__).resolve().parent.parent / ".output/public/assets"
    clients = [p for p in production.glob("client-*.js") if "as jsPDF}" in p.read_text()]
    assert len(clients) == 1, "Build production app first; expected one jsPDF client chunk"
    shutil.copytree(production, ROOT / "production", dirs_exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=shutil.which("chromium"))
        for mode in ["baseline", "candidate"]:
            page = await browser.new_page(timezone_id="Asia/Jakarta")
            errors, blocked = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            async def offline(route):
                if route.request.url.startswith(origin):
                    await route.continue_()
                else:
                    blocked.append(route.request.url)
                    await route.abort()
            await page.route("**/*", offline)
            await page.clock.install(time=1792540800000)
            await page.goto(origin)
            smoke = await page.evaluate("""async filename => {
                const {jsPDF} = await import(`/production/${filename}`);
                const doc = new jsPDF();
                doc.text("Production PDF smoke", 10, 10);
                return doc.output().startsWith("%PDF-");
            }""", clients[0].name)
            assert smoke, "Actual production PDF chunk failed"
            docs = await page.evaluate("""async mode => {
                await import(`/${mode}/fixture.js`);
                return await globalThis.runPdfFixtures();
            }""", mode)
            assert not errors, errors
            assert not blocked, blocked
            hashes = []
            for index, doc in enumerate(docs):
                directory = ROOT / mode / "pdfs"
                directory.mkdir(exist_ok=True)
                pdf = directory / f"{index}.pdf"
                pdf.write_bytes(base64.b64decode(doc["data"]))
                subprocess.run(["pdftoppm", "-r", "96", "-png", str(pdf), str(directory / str(index))], check=True, capture_output=True)
                pages = sorted(directory.glob(f"{index}-*.png"))
                assert pages, f"No pages for {pdf}"
                text = subprocess.check_output(["pdftotext", str(pdf), "-"]).decode()
                assert "MCM" in text
                hashes.append([hashlib.sha256(page.read_bytes()).hexdigest() for page in pages])
            results[mode] = hashes
            await page.close()
        await browser.close()
    server.shutdown()
    assert results["baseline"] == results["candidate"], "PDF raster changed"
    summary = {"fixtures": len(results["candidate"]), "pages": sum(map(len, results["candidate"])), "pixel_differences": 0, "browser_errors": 0, "external_requests": 0, "production_chunk_import": "passed"}
    (ROOT / "result.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))

asyncio.run(main())
