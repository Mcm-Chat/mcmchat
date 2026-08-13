import {
  DOMAIN_HOST,
  EXPECTED_A,
  EXPECTED_TXT,
  LOVABLE_TXT_NAME,
  WWW_HOST,
  type DnsCheck,
  type DomainStatus,
} from "./expected";

type DohAnswer = { name: string; type: number; data: string };

/** Query DNS-over-HTTPS Cloudflare. Tidak memakai resolver lokal (Worker-safe). */
async function doh(name: string, type: "A" | "TXT" | "NS"): Promise<string[]> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: "application/dns-json" } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { Answer?: DohAnswer[] };
    return (json.Answer ?? [])
      .filter((a) => a.data)
      .map((a) => a.data.replace(/^"|"$/g, "").replace(/\.$/, ""));
  } catch {
    return [];
  }
}

async function httpsOk(host: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`https://${host}/`, { redirect: "manual" });
    return { ok: res.status < 400, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "tidak dapat dihubungi" };
  }
}

/** Probe seluruh record yang dibutuhkan agar domain kustom Live. */
export async function probeDomain(): Promise<DomainStatus> {
  const [ns, apex, www, txt, https] = await Promise.all([
    doh(DOMAIN_HOST, "NS"),
    doh(DOMAIN_HOST, "A"),
    doh(WWW_HOST, "A"),
    doh(LOVABLE_TXT_NAME, "TXT"),
    httpsOk(DOMAIN_HOST),
  ]);

  const checks: DnsCheck[] = [
    {
      key: "ns",
      label: "Nameserver di Cloudflare",
      expected: "*.ns.cloudflare.com",
      found: ns,
      ok: ns.length > 0 && ns.every((v) => v.endsWith("ns.cloudflare.com")),
      hint: "Ubah nameserver domain di registrar menjadi nameserver Cloudflare yang ditampilkan pada dashboard Cloudflare.",
    },
    {
      key: "apex",
      label: `Record A ${DOMAIN_HOST}`,
      expected: EXPECTED_A,
      found: apex,
      ok: apex.includes(EXPECTED_A),
      hint: `Cloudflare → DNS → Add record: Type A, Name @, IPv4 ${EXPECTED_A}, Proxy status DNS only.`,
    },
    {
      key: "www",
      label: `Record A ${WWW_HOST}`,
      expected: EXPECTED_A,
      found: www,
      ok: www.includes(EXPECTED_A),
      hint: `Cloudflare → DNS → Add record: Type A, Name www, IPv4 ${EXPECTED_A}, Proxy status DNS only.`,
    },
    {
      key: "txt",
      label: "TXT _lovable (verifikasi kepemilikan)",
      expected: EXPECTED_TXT,
      found: txt,
      ok: txt.some((v) => v.trim() === EXPECTED_TXT),
      hint: `Cloudflare → DNS → Add record: Type TXT, Name _lovable, Content ${EXPECTED_TXT}, TTL Auto.`,
    },
    {
      key: "https",
      label: `HTTPS https://${DOMAIN_HOST}`,
      expected: "HTTP 200 + sertifikat aktif",
      found: [https.detail],
      ok: https.ok,
      hint: "Setelah TXT dan A tersimpan, buka Project Settings → Domains lalu tekan Verify/Complete Setup. Sertifikat terbit beberapa menit setelah verifikasi.",
    },
  ];

  return {
    host: DOMAIN_HOST,
    checkedAt: new Date().toISOString(),
    checks,
    allOk: checks.every((c) => c.ok),
  };
}