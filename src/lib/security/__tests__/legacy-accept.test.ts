import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Banner legacy: satu ketukan "Terima percakapan & hubungkan" harus benar-benar
 * menyambungkan (request + accept dalam satu transaksi), bukan berhenti di
 * pending lalu menyuruh pengguna ke halaman Kontak.
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));

function latestFunction(name: string): string {
  let found = "";
  for (const file of files) {
    const re = new RegExp(
      `create (?:or replace )?function public\\.${name}\\b[\\s\\S]*?\\$(?:function)?\\$;`,
      "gi",
    );
    const matches = file.match(re);
    if (matches?.length) found = matches[matches.length - 1]!;
  }
  return found;
}

const accept = latestFunction("accept_legacy_direct_conversation");
const reject = latestFunction("reject_legacy_direct_conversation");
const chat = readFileSync(path.resolve(process.cwd(), "src/routes/chat.$id.tsx"), "utf8");

describe("accept_legacy_direct_conversation", () => {
  it("ada dan hanya untuk pengguna terautentikasi", () => {
    expect(accept).not.toBe("");
    expect(accept).toMatch(/not_authenticated/);
    expect(accept).toMatch(/security definer/i);
  });

  it("memverifikasi keanggotaan percakapan direct", () => {
    expect(accept).toMatch(/conversation_members/);
    expect(accept).toMatch(/not_authorized/);
    expect(accept).toMatch(/invalid_conversation/);
  });

  it("mengunci pasangan kanonik lalu membaca request FOR UPDATE", () => {
    expect(accept.indexOf("lock_contact_pair")).toBeGreaterThan(-1);
    expect(accept).toMatch(/from public\.contact_requests[\s\S]*for update/i);
    expect(accept.indexOf("lock_contact_pair")).toBeLessThan(
      accept.toLowerCase().indexOf("for update"),
    );
  });

  it("menolak pasangan yang diblokir dan tidak membuat koneksi", () => {
    expect(accept).toMatch(/is_blocked[\s\S]*raise exception 'blocked'/i);
  });

  it("tidak pernah menerima permintaan keluar milik sendiri", () => {
    expect(accept).toMatch(/requester_id = uid[\s\S]*waiting_for_other/i);
  });

  it("membuat request other→current bila belum ada, lalu menerima", () => {
    expect(accept).toMatch(/insert into public\.contact_requests[\s\S]*values \(_other, uid/i);
    expect(accept).toMatch(/set status = 'accepted'/i);
  });

  it("memerlukan bukti pesan masuk sebelum membuat request baru", () => {
    expect(accept).toMatch(/no_incoming_messages/);
  });

  it("membuat tepat satu koneksi aktif dan kartu kontak mutual", () => {
    expect(accept).toMatch(/insert into public\.contact_connections[\s\S]*on conflict/i);
    expect(accept).toMatch(/insert into public\.contacts[\s\S]*on conflict/i);
  });

  it("mematuhi cooldown terminal tanpa bypass", () => {
    expect(accept).toMatch(/rejected_by_other/);
    expect(accept).toMatch(/interval '24 hours'/);
    expect(accept).toMatch(/interval '1 hour'/);
  });

  it("tidak dapat dieksekusi anon", () => {
    const sql = files.join("\n");
    expect(sql).toMatch(
      /revoke all on function public\.accept_legacy_direct_conversation\(uuid\) from public, anon/i,
    );
  });
});

describe("reject_legacy_direct_conversation", () => {
  it("hanya penerima sah yang bisa menolak", () => {
    expect(reject).toMatch(/requester_id = uid[\s\S]*waiting_for_other/i);
    expect(reject).toMatch(/conversation_members/);
  });

  it("menolak secara atomik dengan pair lock", () => {
    expect(reject).toMatch(/lock_contact_pair/);
    expect(reject).toMatch(/set status = 'rejected'/i);
  });
});

describe("banner UI", () => {
  it("memanggil RPC atomik, bukan claim", () => {
    expect(chat).toMatch(/accept_legacy_direct_conversation/);
    expect(chat).toMatch(/reject_legacy_direct_conversation/);
    expect(chat).not.toMatch(/claim_legacy_direct_conversation/);
  });

  it("punya empat state banner", () => {
    expect(chat).toMatch(/Terima percakapan/);
    expect(chat).toMatch(/Batalkan permintaan/);
    expect(chat).toMatch(/Kirim permintaan/);
  });

  it("invalidasi cache tanpa reload penuh", () => {
    expect(chat).toMatch(/invalidateRelation/);
    expect(chat).not.toMatch(/window\.location\.reload/);
  });
});
