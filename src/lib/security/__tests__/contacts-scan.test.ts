import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Invarian keamanan alur simpan kontak hasil pindai QR. */
const sql = readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.resolve("supabase/migrations", f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

const contactsApi = readFileSync(path.resolve("src/lib/api/contacts.ts"), "utf8");
const sheet = readFileSync(path.resolve("src/components/mcm/scan-result-sheet.tsx"), "utf8");

describe("kontak hasil pindai", () => {
  it("tabel contacts punya kolom source, starred, dan unique(owner_id, contact_id)", () => {
    expect(sql).toContain("add column if not exists source text");
    expect(sql).toContain("add column if not exists starred boolean");
    expect(sql).toMatch(/unique index contacts_pair_key on public\.contacts.*owner_id, contact_id/);
  });

  it("owner_id tidak boleh sama dengan contact_id", () => {
    expect(sql).toContain("check (owner_id <> contact_id)");
  });

  it("contact_id harus menunjuk profil valid", () => {
    expect(sql).toContain("foreign key (contact_id) references public.profiles(id)");
  });

  it("RLS contacts hanya untuk pemilik", () => {
    const policies =
      sql.match(/create policy "own contacts [^"]+" on public\.contacts[^;]+;/g) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(4);
    for (const p of policies) expect(p).toContain("owner_id = auth.uid()");
  });

  it("pencarian profil memakai RPC atomik, bukan sapuan tabel profiles", () => {
    expect(contactsApi).toContain('supabase.rpc("search_profile_by_pin"');
    expect(contactsApi).not.toMatch(/from\("profiles"\)[\s\S]{0,80}select\("\*"\)/);
  });

  it("simpan kontak idempoten dan menolak PIN sendiri", () => {
    expect(contactsApi).toContain('supabase.rpc("save_contact_card"');
    expect(contactsApi).toContain("PIN ini milik Anda sendiri.");
  });

  it('"Gunakan Tanpa Menyimpan" tidak menulis kontak maupun request', () => {
    const branch = sheet.slice(sheet.indexOf("onUseWithoutSaving?.({ profile })"));
    expect(branch).not.toContain("saveContact(");
    expect(branch).not.toContain("sendContactRequest(");
  });

  it("kontak tidak disimpan di localStorage", () => {
    expect(contactsApi).not.toContain("localStorage");
    expect(sheet).not.toContain("localStorage");
  });
});
