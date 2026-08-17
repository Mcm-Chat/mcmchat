import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { safeUrl, isBlockedIPv6, unfurl, __clearPreviewCache } from "../link-preview.server";

const html = (extra = "") =>
  new Response(`<html><head><meta property="og:title" content="Judul">${extra}</head></html>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
const redirect = (loc: string) =>
  new Response(null, { status: 302, headers: { location: loc } });

describe("safeUrl", () => {
  it("menerima URL publik", () => {
    expect(safeUrl("https://example.org/a")?.toString()).toBe("https://example.org/a");
  });

  it.each([
    "http://127.0.0.1/",
    "http://localhost/",
    "http://169.254.169.254/latest/meta-data",
    "http://0x7f.1/",
    "http://2130706433/",
    "http://10.0.0.5/",
    "http://100.64.1.1/",
    "http://example.internal/",
    "http://user:pw@example.org/",
    "file:///etc/passwd",
    "http://example.org:8080/",
    "http://example.org:22/",
    "http://%6c%6f%63%61%6c%68%6f%73%74/",
    "http://127.0.0.1./",
  ])("menolak %s", (u) => {
    expect(safeUrl(u)).toBeNull();
  });
});

describe("IPv6", () => {
  it.each([
    "[::1]",
    "[::]",
    "[::ffff:169.254.169.254]",
    "[::ffff:127.0.0.1]",
    "[0:0:0:0:0:ffff:7f00:1]",
    "[fd00::1]",
    "[fc00::1]",
    "[fe80::1]",
    "[fe80::1%25eth0]",
    "[fec0::1]",
    "[2001:db8::1]",
    "[2002:7f00:1::1]",
    "[64:ff9b::a00:1]",
    "[ff02::1]",
    "[gggg::1]",
  ])("memblokir %s", (h) => {
    expect(isBlockedIPv6(h)).toBe(true);
    expect(safeUrl(`http://${h}/`)).toBeNull();
  });

  it("mengizinkan IPv6 publik", () => {
    expect(isBlockedIPv6("[2606:4700::1111]")).toBe(false);
    expect(safeUrl("http://[2606:4700::1111]/")).not.toBeNull();
  });
});

describe("redirect", () => {
  beforeEach(() => {
    __clearPreviewCache();
    vi.restoreAllMocks();
  });
  afterEach(() => __clearPreviewCache());

  it("memblokir redirect ke host internal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => redirect("http://169.254.169.254/latest")),
    );
    expect(await unfurl("https://example.org/x")).toBeNull();
  });

  it("memblokir redirect internal di hop terakhir rantai", async () => {
    const hops = ["https://a.example/1", "https://b.example/2", "http://[::1]/3"];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => redirect(hops[i++]!)));
    expect(await unfurl("https://example.org/x")).toBeNull();
  });

  it("membatasi jumlah hop", async () => {
    let i = 0;
    const f = vi.fn(async () => redirect(`https://example.org/hop${i++}`));
    vi.stubGlobal("fetch", f);
    expect(await unfurl("https://example.org/x")).toBeNull();
    expect(f.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("menolak loop redirect", async () => {
    const seq = ["https://example.org/b", "https://example.org/x"];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async () => redirect(seq[i++ % 2]!)));
    expect(await unfurl("https://example.org/x")).toBeNull();
  });

  it("menolak downgrade https ke http", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => redirect("http://example.org/plain")));
    expect(await unfurl("https://example.org/x")).toBeNull();
  });

  it("mengikuti redirect publik yang sah", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (n++ === 0 ? redirect("https://cdn.example.org/final") : html())),
    );
    const r = await unfurl("https://example.org/x");
    expect(r?.url).toBe("https://cdn.example.org/final");
  });
});

describe("cache", () => {
  beforeEach(() => {
    __clearPreviewCache();
    vi.restoreAllMocks();
  });
  afterEach(() => __clearPreviewCache());

  it("tidak memanggil fetch dua kali untuk URL sama", async () => {
    const f = vi.fn(async () => html());
    vi.stubGlobal("fetch", f);
    await unfurl("https://example.org/a");
    await unfurl("https://example.org/a#frag");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("cache negatif tidak memicu fetch ulang segera", async () => {
    const f = vi.fn(async () => new Response("no", { status: 500 }));
    vi.stubGlobal("fetch", f);
    expect(await unfurl("https://example.org/b")).toBeNull();
    expect(await unfurl("https://example.org/b")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("URL terblokir tidak pernah menyentuh fetch meski dipanggil ulang", async () => {
    const f = vi.fn(async () => html());
    vi.stubGlobal("fetch", f);
    expect(await unfurl("http://169.254.169.254/")).toBeNull();
    expect(await unfurl("http://169.254.169.254/")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("gambar internal dari meta dibuang", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => html(`<meta property="og:image" content="http://127.0.0.1/x.png">`)),
    );
    const r = await unfurl("https://example.org/img");
    expect(r?.image).toBeNull();
  });
});
