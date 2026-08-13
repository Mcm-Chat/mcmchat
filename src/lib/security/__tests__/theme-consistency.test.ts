import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ROUTES = ["chat.index", "status.index", "tasks.index", "catalog.index", "finance.index", "profile.index"];
const read = (p: string) => readFileSync(p, "utf8");

describe("tema global konsisten di enam menu", () => {
  it("tidak ada route yang memutasi tema saat dibuka", () => {
    for (const r of ROUTES) {
      const src = read(`src/routes/${r}.tsx`);
      expect(src, `${r} tidak boleh menyentuh documentElement`).not.toMatch(/document\.documentElement/);
      expect(src, `${r} tidak boleh memanggil setTheme di useEffect`).not.toMatch(/useEffect\([^)]*\)\s*=>\s*\{[^}]*setTheme\(/s);
    }
  });

  it("tidak ada latar hardcode yang menabrak token tema", () => {
    for (const r of ROUTES) {
      const src = read(`src/routes/${r}.tsx`);
      expect(src, `${r} memakai warna hardcode`).not.toMatch(/bg-white\b|bg-slate-\d|app-gradient|text-navy-foreground/);
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
    expect(src).toMatch(/disabled=\{saving\}/);
  });

  it("keuangan memperbarui ringkasan realtime dari tabel ledgers", () => {
    expect(read("src/routes/finance.index.tsx")).toMatch(/table: "ledgers"/);
  });
});
