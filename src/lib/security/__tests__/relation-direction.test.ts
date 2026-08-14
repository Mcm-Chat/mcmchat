import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Arah permintaan kontak tidak boleh dibalik.
 *
 * Pemohon (outgoing pending) harus tetap melihat status "menunggu diterima";
 * hanya target yang melihat Terima/Tolak. `claim_legacy_direct_conversation`
 * wajib melaporkan pending apa adanya tanpa mutation.
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

const claim = latestFunction("claim_legacy_direct_conversation");
const relation = latestFunction("my_direct_relation_state");
const chat = readFileSync(path.resolve(process.cwd(), "src/routes/chat.$id.tsx"), "utf8");

describe("claim_legacy_direct_conversation menjaga arah permintaan", () => {
  it("mengunci pasangan kontak sebelum membaca permintaan", () => {
    expect(claim).toMatch(/lock_contact_pair/i);
    expect(claim).toMatch(/from public\.contact_requests[\s\S]*for update/i);
  });

  it("mengembalikan pending apa adanya sebelum mutation apa pun", () => {
    const pendingReturn = claim.search(/status'?,'pending','code','already_pending'/i);
    const firstUpdate = claim.search(/update public\.contact_requests/i);
    const firstInsert = claim.search(/insert into public\.contact_requests/i);
    expect(pendingReturn).toBeGreaterThan(-1);
    expect(pendingReturn).toBeLessThan(firstUpdate);
    expect(pendingReturn).toBeLessThan(firstInsert);
  });

  it("arah pending dihitung dari target_id, tidak dipaksa incoming", () => {
    const block = claim.slice(
      claim.search(/status = 'pending' then/i),
      claim.search(/no_incoming_messages/i),
    );
    expect(block).toMatch(/target_id = uid then 'incoming' else 'outgoing'/i);
    expect(block).not.toMatch(/update public\.contact_requests/i);
  });

  it("pending outgoing tidak terhalang syarat pesan masuk", () => {
    expect(claim.search(/already_pending/i)).toBeLessThan(claim.search(/no_incoming_messages/i));
  });

  it("pembalikan requester/target hanya untuk state terminal setelah cooldown", () => {
    const reversal = claim.search(/set requester_id = _other, target_id = uid/i);
    expect(reversal).toBeGreaterThan(claim.search(/cooldown/i));
    expect(claim).toMatch(/interval '1 hour'/i);
    expect(claim).toMatch(/interval '24 hours'/i);
  });

  it("my_direct_relation_state melaporkan arah tanpa menulis apa pun", () => {
    expect(relation).toMatch(/target_id = uid then 'incoming' else 'outgoing'/i);
    expect(relation).not.toMatch(/\b(insert|update|delete)\s+(into\s+)?public\.contact_requests/i);
  });
});

describe("banner percakapan memakai state hubungan live", () => {
  it("mengambil state dari my_direct_relation_state", () => {
    expect(chat).toMatch(/rpc\("my_direct_relation_state"/);
  });

  it("pemohon melihat status menunggu + tombol batalkan", () => {
    expect(chat).toContain("Permintaan kontak sudah dikirim ke ");
    expect(chat).toContain("Menunggu diterima.");
    expect(chat).toContain("Batalkan permintaan");
    expect(chat).toMatch(/request_direction === "outgoing"/);
  });

  it("penerima melihat Terima/Tolak", () => {
    expect(chat).toMatch(/request_direction === "incoming"/);
    expect(chat).toMatch(/respondRequest\("accepted"\)/);
    expect(chat).toMatch(/respondRequest\("rejected"\)/);
  });
});
