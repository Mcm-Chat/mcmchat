import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";

const ROUTES = [
  "chat.index",
  "status.index",
  "tasks.index",
  "catalog.index",
  "finance.index",
  "profile.index",
];
const read = (p: string) => readFileSync(p, "utf8");

describe("tema global konsisten di enam menu", () => {
  it("tidak ada route yang memutasi tema saat dibuka", () => {
    for (const r of ROUTES) {
      const src = read(`src/routes/${r}.tsx`);
      expect(src, `${r} tidak boleh menyentuh documentElement`).not.toMatch(
        /document\.documentElement/,
      );
      expect(src, `${r} tidak boleh memanggil setTheme di useEffect`).not.toMatch(
        /useEffect\([^)]*\)\s*=>\s*\{[^}]*setTheme\(/s,
      );
    }
  });

  it("tidak ada latar hardcode yang menabrak token tema", () => {
    for (const r of ROUTES) {
      const src = read(`src/routes/${r}.tsx`);
      expect(src, `${r} memakai warna hardcode`).not.toMatch(
        /bg-white\b|bg-black\b|bg-slate-\d|text-(white|emerald|amber|slate|rose)-?\d*\b|app-gradient|text-navy-foreground/,
      );
    }
  });

  it("AppShell dan header memakai token semantik", () => {
    const shell = read("src/components/mcm/app-shell.tsx");
    expect(shell).toMatch(/bg-card\/95/);
    expect(shell).toMatch(/text-foreground/);
  });

  it("tema dibaca dari satu ThemeProvider global", () => {
    const theme = read("src/lib/theme.tsx");
    expect(theme).toMatch(/export function ThemeProvider/);
    expect(theme).toMatch(/THEME_BOOTSTRAP_SCRIPT/);
    expect(read("src/routes/__root.tsx")).toMatch(/<ThemeProvider>/);
  });
});

describe("aksi tambah pada Tugas dan Keuangan", () => {
  it("halaman Tugas punya tombol buat penyiapan dan memakai dialog yang sama", () => {
    const src = read("src/routes/tasks.index.tsx");
    expect(src).toMatch(/CreatePreparationDialog/);
    expect(src).toMatch(/Buat Penyiapan/);
  });

  it("halaman Keuangan punya tombol catat dan memakai form ledger bersama", () => {
    const src = read("src/routes/finance.index.tsx");
    expect(src).toMatch(/LedgerFormDialog/);
    expect(src).toMatch(/Tambah Catatan/);
  });

  it("chat memakai form ledger bersama, bukan implementasi kedua", () => {
    const src = read("src/routes/chat.$id.tsx");
    expect(src).toMatch(/LedgerFormDialog/);
    expect(src).not.toMatch(/createLedger\(/);
  });
});

describe("preferensi tema terisolasi per akun", () => {
  it("theme.tsx memakai scopedKey dan memuat ulang saat account switch", () => {
    const theme = read("src/lib/theme.tsx");
    expect(theme).toMatch(/scopedKey\("theme"/);
    expect(theme).toMatch(/onAccountSwitch/);
    // Tidak boleh memakai key global sebagai sumber preferensi akun.
    expect(theme).not.toMatch(/localStorage\.getItem\("mcm-theme"\)/);
  });

  it("tema hanya berubah lewat aksi eksplisit pengguna, bukan avatar/foto", () => {
    const profile = read("src/routes/profile.index.tsx");
    const avatar = read("src/components/mcm/avatar-editor.tsx");
    expect(avatar).not.toMatch(/setTheme\(/);
    // setTheme di Profil hanya dipanggil dari handler switch tema.
    expect(profile.match(/setTheme\(/g)?.length ?? 0).toBe(1);
  });
});

describe("form penyiapan dan ledger tahan double-submit", () => {
  it("dialog penyiapan mengunci tombol saat mengirim", () => {
    const src = read("src/components/mcm/prepare-parts.tsx");
    expect(src).toMatch(/disabled=\{sending\}/);
    expect(src).toMatch(/if \(sending\) return;/);
  });

  it("form ledger mengunci submit dan menutup dialog saat menyimpan", () => {
    const src = read("src/components/mcm/ledger-form.tsx");
    expect(src).toMatch(/if \(saving\) return;/);
    // Tombol boleh punya syarat tambahan (validasi), tapi wajib terkunci saat menyimpan.
    expect(src).toMatch(/disabled=\{saving\b/);
  });

  it("keuangan memperbarui ringkasan realtime dari tabel ledgers", () => {
    expect(read("src/routes/finance.index.tsx")).toMatch(/table: "ledgers"/);
  });
});

describe("token desain terpadu navy + emerald", () => {
  const css = read("src/styles.css");

  it("radius standar 16px dan skala turunannya konsisten", () => {
    expect(css).toMatch(/--radius:\s*1rem/);
    expect(css).toMatch(/--radius-lg:\s*var\(--radius\)/);
    expect(css).toMatch(/--radius-xl:\s*var\(--radius\)/);
  });

  it("primary emerald & navy terdefinisi di light dan dark", () => {
    const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    const dark = css.slice(css.indexOf(".dark {"));
    for (const [scope, block] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const primary = block.match(/--primary:\s*oklch\([\d.]+ [\d.]+ ([\d.]+)\)/);
      expect(primary, `${scope} tidak punya --primary`).toBeTruthy();
      // Hue emerald 150–172; bukan teal/cyan lama (178+).
      expect(Number(primary![1])).toBeGreaterThanOrEqual(150);
      expect(Number(primary![1])).toBeLessThanOrEqual(172);
      expect(block, `${scope} tidak punya --navy`).toMatch(/--navy:\s*oklch/);
    }
  });

  it("tidak ada warna literal Tailwind di layar aplikasi", () => {
    const files = globSync("src/{routes,components/mcm}/**/*.tsx");
    expect(files.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const f of files) {
      const src = read(f);
      const hit = src.match(
        /\b(?:bg|text|border|ring|from|to|via)-(?:white|black|slate|gray|zinc|emerald|teal|amber|rose|red|green|blue|indigo|purple|orange|sky|cyan)(?:-\d{2,3})?(?:\/\d+)?\b/g,
      );
      if (hit) bad.push(`${f}: ${[...new Set(hit)].join(", ")}`);
    }
    expect(bad, `warna literal harus diganti token semantik:\n${bad.join("\n")}`).toEqual([]);
  });

  it("skala tipografi didefinisikan sekali di base layer", () => {
    expect(css).toMatch(/@utility screen-title/);
    expect(css).toMatch(/h1 \{[\s\S]*?font-size: 1\.25rem/);
  });
});
