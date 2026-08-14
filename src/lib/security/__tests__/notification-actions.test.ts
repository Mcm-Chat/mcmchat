import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Invarian token aksi notifikasi.
 *
 * Desain: SATU baris = SATU aksi = SATU token sekali-pakai, terikat ke
 * perangkat + sumber daya, dengan `used_at`/`result` sebagai batas idempotensi.
 * Tidak ada array multi-aksi, tidak ada bearer persisten di perangkat.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));

const sql = files.join("\n");

/** Definisi terakhir sebuah fungsi (state live = migrasi paling akhir). */
function latestFunction(name: string): string {
  let found = "";
  for (const file of files) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\b[\\s\\S]*?\\n\\$\\$;`, "gi");
    const matches = file.match(re);
    if (matches?.length) found = matches[matches.length - 1]!;
  }
  return found;
}

const consume = latestFunction("consume_notification_action");
const mint = latestFunction("mint_notification_action");
const register = latestFunction("register_push_device");

describe("skema notification_actions", () => {
  it("tabel lama push_action_tokens dihapus, bukan sekadar dicabut izinnya", () => {
    expect(sql).toMatch(/drop table if exists public\.push_action_tokens/i);
  });

  it("tidak ada tabel/kolom multi-aksi tersisa", () => {
    expect(consume).not.toMatch(/allowed_actions/i);
    expect(mint).not.toMatch(/allowed_actions/i);
  });

  it("tidak ada grant klien pada notification_actions", () => {
    const grants = sql.match(/grant[^;]*notification_actions[^;]*;/gi) ?? [];
    for (const g of grants) {
      expect(g.toLowerCase()).not.toMatch(/\bto\s+(anon|authenticated|public)\b/);
    }
  });

  it("kredensial aksi persisten perangkat dihapus permanen", () => {
    expect(sql).toMatch(/drop column if exists action_token_hash/i);
    expect(register).not.toMatch(/action_token_hash|action_token_prefix/i);
    expect(sql).toMatch(/drop function if exists public\.device_from_action_token/i);
  });

  it("fungsi aksi latar lama (check-then-insert) dihapus", () => {
    for (const fn of ["bg_reply_message", "bg_mark_read", "bg_mark_delivered"]) {
      expect(sql).toMatch(new RegExp(`drop function if exists public\\.${fn}`, "i"));
    }
  });

  it("ada pembersih aksi kedaluwarsa dengan index pendukung", () => {
    expect(sql).toMatch(/create or replace function public\.cleanup_expired_notification_actions/i);
    expect(sql).toMatch(/notification_actions_cleanup_idx/i);
  });
});

describe("mint: satu token per aksi, deadline nyata", () => {
  it("aksi panggilan memakai created_at + 45 detik, bukan lantai 30 detik", () => {
    expect(mint).toMatch(/created_at \+ interval '45 seconds'/i);
    expect(mint).toMatch(/ring_deadline_passed/);
    // Lantai TTL hanya berlaku untuk aksi pesan.
    const callBranch = mint.slice(mint.indexOf("call_answer"));
    expect(callBranch).not.toMatch(/greatest\(30/);
  });

  it("read terikat ke pesan yang benar-benar ada di percakapan itu", () => {
    expect(mint).toMatch(/m\.id = _message and m\.conversation_id = _conversation/i);
  });

  it("aksi tak dikenal ditolak", () => {
    expect(mint).toMatch(/invalid_action/);
  });
});

describe("consume: single-use atomik", () => {
  it("mengunci baris sebelum efek samping apa pun", () => {
    const lock = consume.toLowerCase().indexOf("for update");
    const firstEffect = Math.min(
      ...["insert into public.messages", "insert into public.message_receipts", "_answer_call_as"]
        .map((s) => consume.toLowerCase().indexOf(s))
        .filter((i) => i >= 0),
    );
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(firstEffect);
  });

  it("replay dicek setelah lock dan sebelum efek samping", () => {
    const lock = consume.toLowerCase().indexOf("for update");
    const replay = consume.toLowerCase().indexOf("used_at is not null");
    const firstEffect = consume.toLowerCase().indexOf("insert into public.messages");
    expect(replay).toBeGreaterThan(lock);
    expect(replay).toBeLessThan(firstEffect);
    expect(consume).toMatch(/coalesce\(_row\.result/i);
  });

  it("menandai used_at + result pada transaksi yang sama", () => {
    expect(consume).toMatch(/update public\.notification_actions[\s\S]*set used_at = now\(\), result = _res/i);
  });

  it("menolak token untuk sumber daya lain", () => {
    expect(consume).toMatch(/resource_mismatch/);
  });

  it("mengecek ulang kapabilitas terkini, bukan sekadar keanggotaan", () => {
    expect(consume).toMatch(/conversation_capability\(_row\.conversation_id, _row\.user_id\)/i);
    expect(consume).toMatch(/cap\.sendable/i);
    expect(consume).toMatch(/cap\.readable/i);
    expect(consume).not.toMatch(/is_conv_member\(/i);
  });

  it("panggilan memakai helper internal bersama, bukan updater langsung", () => {
    expect(consume).toMatch(/_answer_call_as\(/);
    expect(consume).toMatch(/_decline_call_as\(/);
    expect(consume).not.toMatch(/bg_call_action/);
  });
});

/**
 * Konkurensi: model dua permintaan paralel terhadap SATU baris aksi dengan
 * semantik `SELECT ... FOR UPDATE` (baris terkunci sampai transaksi selesai).
 * Efek samping harus terjadi tepat satu kali dan pemanggil kedua menerima
 * hasil tersimpan.
 */
describe("konkurensi consume", () => {
  it("dua consume paralel menjalankan efek samping tepat sekali", async () => {
    const row: { used_at: number | null; result: unknown } = { used_at: null, result: null };
    let effects = 0;
    let lock: Promise<void> = Promise.resolve();

    const consumeOnce = async () => {
      // Antrian lock baris (FOR UPDATE): transaksi berikutnya menunggu commit.
      const previous = lock;
      let release!: () => void;
      lock = new Promise<void>((r) => (release = r));
      await previous;
      try {
        if (row.used_at !== null) return { ...(row.result as object), replayed: true };
        await new Promise((r) => setTimeout(r, 5)); // jendela race
        effects += 1;
        const res = { ok: true, messageId: `m${effects}` };
        row.used_at = Date.now();
        row.result = res;
        return res;
      } finally {
        release();
      }
    };

    const [a, b] = await Promise.all([consumeOnce(), consumeOnce()]);
    expect(effects).toBe(1);
    expect(a).toMatchObject({ ok: true, messageId: "m1" });
    expect(b).toMatchObject({ ok: true, messageId: "m1", replayed: true });
  });
});
