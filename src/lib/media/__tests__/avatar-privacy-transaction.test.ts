import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Privasi foto profil harus transaksional:
 * mode `contacts_except` / `only_share` hanya aktif bila audiensnya tersimpan.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const { saveAvatarPrivacyAudience } = await import("../../api/avatar");

const sql = readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.resolve(process.cwd(), "supabase/migrations", f), "utf8"))
  .join("\n")
  .replace(/\s+/g, " ")
  .toLowerCase();

const fn = sql.slice(
  sql.lastIndexOf("create or replace function public.set_avatar_privacy_audience"),
);

describe("RPC set_avatar_privacy_audience (invarian SQL)", () => {
  it("ada, atomik (satu fungsi), dan security definer dengan search_path terkunci", () => {
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = public/);
  });

  it("memastikan pemanggil adalah pemilik profil (auth.uid())", () => {
    expect(fn).toMatch(/auth\.uid\(\)/);
    expect(fn).toMatch(/update public\.profiles set avatar_privacy = _privacy[^;]*where id = _uid/);
  });

  it("hanya menerima contacts_except dan only_share", () => {
    expect(fn).toMatch(/_privacy = 'contacts_except'/);
    expect(fn).toMatch(/_privacy = 'only_share'/);
    expect(fn).toMatch(/mode privasi tidak didukung/);
  });

  it("memvalidasi target sebagai kontak yang tidak diblokir (rollback bila tidak)", () => {
    expect(fn).toMatch(
      /from public\.contacts c where c\.owner_id = _uid and c\.contact_id = t and c\.is_blocked = false/,
    );
    expect(fn).toMatch(/sebagian kontak tidak valid atau diblokir/);
  });

  it("menolak only_share kosong tanpa konfirmasi, contacts_except kosong tetap boleh", () => {
    expect(fn).toMatch(
      /_privacy = 'only_share' and _count = 0 and _confirm_empty_only_share is not true then raise exception/,
    );
    expect(fn).not.toMatch(/_privacy = 'contacts_except' and _count = 0 then raise/);
  });

  it("mengganti audiens dan privacy bersama-sama, tanpa membocorkan daftar audiens", () => {
    expect(fn).toMatch(
      /delete from public\.avatar_audience where owner_id = _uid and mode = _mode/,
    );
    expect(fn).toMatch(/insert into public\.avatar_audience/);
    expect(fn).toMatch(/return jsonb_build_object\('privacy', _privacy, 'count', _count\)/);
    expect(fn).not.toMatch(/return query select .*target_id/);
  });

  it("grant aman: hanya authenticated, bukan anon/public", () => {
    expect(sql).toMatch(
      /revoke all on function public\.set_avatar_privacy_audience\(text, uuid\[\], boolean\) from public, anon/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.set_avatar_privacy_audience\(text, uuid\[\], boolean\) to authenticated/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.set_avatar_privacy_audience[^;]*to anon/,
    );
  });
});

describe("saveAvatarPrivacyAudience (klien)", () => {
  beforeEach(() => rpc.mockReset());

  it("simpan sukses atomik mengembalikan jumlah dari server", async () => {
    rpc.mockResolvedValue({ data: { privacy: "only_share", count: 2 }, error: null });
    const count = await saveAvatarPrivacyAudience("only_share", ["a", "b"], false);
    expect(count).toBe(2);
    expect(rpc).toHaveBeenCalledWith("set_avatar_privacy_audience", {
      _privacy: "only_share",
      _targets: ["a", "b"],
      _confirm_empty_only_share: false,
    });
  });

  it("only_share kosong tanpa konfirmasi ditolak server dan melempar", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Konfirmasi diperlukan untuk berbagi tanpa penerima" },
    });
    await expect(saveAvatarPrivacyAudience("only_share", [], false)).rejects.toThrow(/konfirmasi/i);
  });

  it("only_share kosong dengan konfirmasi diteruskan sebagai true", async () => {
    rpc.mockResolvedValue({ data: { privacy: "only_share", count: 0 }, error: null });
    await expect(saveAvatarPrivacyAudience("only_share", [], true)).resolves.toBe(0);
    expect((rpc.mock.calls[0] as unknown[])[1]).toMatchObject({ _confirm_empty_only_share: true });
  });

  it("target tidak valid gagal tanpa perubahan lokal (error dilempar)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Sebagian kontak tidak valid atau diblokir" },
    });
    await expect(saveAvatarPrivacyAudience("only_share", ["x"], false)).rejects.toThrow(
      /tidak valid/i,
    );
  });

  it("contacts_except kosong valid", async () => {
    rpc.mockResolvedValue({ data: { privacy: "contacts_except", count: 0 }, error: null });
    await expect(saveAvatarPrivacyAudience("contacts_except", [], false)).resolves.toBe(0);
  });
});

describe("UI profil: mode berbasis daftar tidak menyentuh DB sebelum simpan", () => {
  const src = readFileSync(path.resolve(process.cwd(), "src/routes/profile.index.tsx"), "utf8");
  const dialog = readFileSync(
    path.resolve(process.cwd(), "src/components/mcm/avatar-audience-dialog.tsx"),
    "utf8",
  );

  it("changeAvatarPrivacy menunda mode berbasis daftar sebagai pending", () => {
    const body = src.slice(
      src.indexOf("const changeAvatarPrivacy"),
      src.indexOf("const onAudienceSaved"),
    );
    const guard = body.indexOf("needsAudience(value)");
    expect(guard).toBeGreaterThan(-1);
    // setAvatarPrivacy hanya dipanggil setelah guard (mode biasa saja).
    expect(body.indexOf("await setAvatarPrivacy(")).toBeGreaterThan(guard);
    expect(body).toMatch(/setPendingAvatarPrivacy\(value\);\s*setAudienceOpen\(true\);\s*return;/);
  });

  it("batal/tutup dialog hanya membersihkan pending, tidak mengubah mode aktif", () => {
    expect(src).toMatch(/if \(!o\) setPendingAvatarPrivacy\(null\)/);
    expect(dialog).not.toMatch(/setAvatarPrivacy\(/);
  });

  it("dialog menyimpan lewat RPC atomik dan meneruskan konfirmasi kosong", () => {
    expect(dialog).toMatch(/saveAvatarPrivacyAudience\(privacy, selected, confirmEmpty\)/);
    expect(dialog).not.toMatch(/setAvatarAudience\(/);
  });

  it("mode aktif baru diterapkan hanya di onAudienceSaved", () => {
    const saved = src.slice(src.indexOf("const onAudienceSaved"));
    expect(saved).toMatch(/setAvatarPrivacyState\(privacy\)/);
    expect(saved).toMatch(/setAudienceCount\(count\)/);
    expect(saved).toMatch(/await refresh\(\)/);
  });
});
