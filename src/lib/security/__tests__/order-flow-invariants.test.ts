import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Invariant guard untuk alur pesanan chat → penyiapan → pengiriman.
 * Selalu memeriksa DEFINISI TERAKHIR tiap fungsi (urut file migration = urut eksekusi),
 * sehingga tes ini mencerminkan bentuk fungsi yang benar-benar aktif di database.
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const raw = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n");

/** Ambil body definisi terakhir dari sebuah fungsi. */
function fn(name: string): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\$(fn|\\w*)\\$;`,
    "gi",
  );
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) last = m[0];
  expect(last, `definisi ${name} tidak ditemukan`).not.toBe("");
  return last.toLowerCase();
}

const cancel = fn("cancel_chat_order");
const complete = fn("complete_preparation_job");
const dispatch = fn("dispatch_chat_order");
const create = fn("create_chat_order");
const finalize = fn("finalize_chat_order_delivery");
const balance = fn("apply_unit_balance");
const sql = raw.toLowerCase();

describe("1) cancel memakai slot.mode sebagai SSOT", () => {
  it("tidak lagi membedakan unit lewat source_type", () => {
    expect(cancel).not.toMatch(/source_type\s*<>\s*'preparation'/);
  });
  it("release existing/ready berdasarkan mode slot dan ref deterministik per slot", () => {
    expect(cancel).toMatch(/s\.mode\s*=\s*'prepare_new'/);
    expect(cancel).toMatch(/status in \('reserved','ready'\)/);
    expect(cancel).toMatch(/apply_unit_balance\(u, u\.qty_base, 'release'[^)]*'slot:'/);
  });
});

describe("2) slot cancelled mempertahankan audit link", () => {
  it("cancel tidak mengosongkan stock_unit_id", () => {
    expect(cancel).not.toMatch(/set status = 'cancelled', stock_unit_id = null/);
  });
  it("unique alokasi slot bersifat partial hanya slot non-cancelled", () => {
    expect(sql).toMatch(/drop index if exists public\.chat_order_slots_unit;/);
    expect(sql).toMatch(
      /create unique index chat_order_slots_unit_active on public\.chat_order_unit_slots \(stock_unit_id\)\s*where stock_unit_id is not null and status <> 'cancelled'/,
    );
  });
});

describe("3) urutan lock konsisten", () => {
  it("cancel: chat_order → preparation_job → slots → units", () => {
    const order = cancel.indexOf("from public.chat_orders where id = _order for update");
    const job = cancel.indexOf(
      "from public.preparation_jobs where id = o.preparation_job_id for update",
    );
    const slots = cancel.indexOf("from public.chat_order_unit_slots where chat_order_id = o.id");
    expect(order).toBeGreaterThan(-1);
    expect(job).toBeGreaterThan(order);
    expect(slots).toBeGreaterThan(job);
  });
  it("complete: chat_order dikunci sebelum preparation_job", () => {
    const order = complete.indexOf("from public.chat_orders where id = _order for update");
    const job = complete.indexOf("from public.preparation_jobs where id = _job for update");
    expect(order).toBeGreaterThan(-1);
    expect(job).toBeGreaterThan(order);
    expect(complete).toMatch(/chat_order_id is distinct from _order then raise/);
  });
});

describe("4) satu primary photo per unit", () => {
  it("counter foto direset per unit, bukan per job", () => {
    expect(complete).not.toMatch(/is_primary[\s\S]{0,400}\(_photos = 0\)/);
    expect((complete.match(/\(_uphotos = 0\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(complete).toMatch(/_uphotos := 0;/);
  });
});

describe("5-6) verifikasi unit existing", () => {
  it("menolak unit yang tidak terkait order/slot ini", () => {
    expect(complete).toMatch(/u\.chat_order_id is distinct from j\.chat_order_id/);
    expect(complete).toMatch(/u\.unit_slot_id is distinct from it\.chat_order_slot_id/);
    expect(complete).toMatch(/u\.status not in \('reserved','preparing','ready'\)/);
  });
  it("tetap memvalidasi foto/lokasi wajib untuk unit existing", () => {
    expect(complete).toMatch(
      /it\.require_photo and not \([\s\S]{0,300}product_photos where stock_unit_id = u\.id/,
    );
    expect(complete).toMatch(
      /it\.require_location and not \([\s\S]{0,400}location_lat is not null/,
    );
  });
});

describe("7) saldo penyiapan tidak dobel", () => {
  it("penyiapan stok umum tidak mengurangi saldo (net nol)", () => {
    expect(complete).not.toMatch(/update public\.inventory_balances set qty_base = _after/);
    expect(complete).toMatch(
      /if j\.chat_order_id is not null then\s*perform public\.apply_unit_balance\(_newu, -_qty, 'consume'/,
    );
  });
});

describe("8) movement idempoten", () => {
  it("ref_id deterministik, bukan uuid acak", () => {
    expect(balance).not.toMatch(/gen_random_uuid\(\)/);
    expect(balance).toMatch(/_ref := md5\('stock_unit:'/);
    expect(balance).toMatch(/ref key wajib/);
    expect(balance).toMatch(
      /if exists \(select 1 from public\.inventory_movements m where m\.ref_type = _reftype and m\.ref_id = _ref\)/,
    );
  });
});

describe("9) validasi slot dispatch", () => {
  it("menolak slot_no ganda, jumlah salah, dan pesanan berlebihan", () => {
    expect(dispatch).toMatch(
      /group by \(e->>'item_id'\)::uuid, \(e->>'slot_no'\)::int having count\(\*\) > 1/,
    );
    expect(dispatch).toMatch(/total slot \(%\) harus sama dengan total unit pesanan/);
    expect(dispatch).toMatch(/nomor slot % harus 1\.\.%/);
    expect(dispatch).toMatch(/_total > 200/);
    expect(dispatch).not.toMatch(/coalesce\(\(_s->>'slot_no'\)::int, _i\)/);
  });
});

describe("10-11) create_chat_order", () => {
  it("idempoten dengan advisory lock dan penanganan unique violation", () => {
    expect(create).toMatch(/pg_advisory_xact_lock\(hashtextextended\('chat_order:'/);
    expect(create).toMatch(/exception when unique_violation then/);
  });
  it("pembeli diturunkan dari percakapan, bukan payload", () => {
    expect(create).toMatch(/from public\.business_conversations bc/);
    expect(create).toMatch(/from public\.direct_conversations dc/);
    expect(create).toMatch(/pembeli harus peserta percakapan ini/);
    expect(create).not.toMatch(/then nullif\(_payload->>'buyer_user_id',''\)::uuid else _uid end/);
  });
});

describe("12-13,15) finalisasi pengiriman", () => {
  it("memvalidasi unit unik dan keterkaitannya dengan slot/item", () => {
    expect(finalize).toMatch(/count\(distinct stock_unit_id\)/);
    expect(finalize).toMatch(/setiap slot harus memiliki unit fisik yang berbeda/);
    expect(finalize).toMatch(/u\.unit_slot_id is distinct from s\.id/);
    expect(finalize).toMatch(/u\.chat_order_item_id is distinct from s\.item_id/);
    expect(finalize).toMatch(/varian unit tidak cocok/);
  });
  it("unit terkirim menunjuk baris pesanan akhir dan payload menyertakannya", () => {
    expect(finalize).toMatch(/set order_id = _ord\.id, order_item_id = _oi/);
    expect(finalize).toMatch(/'orderitemid', u\.order_item_id/);
    expect(finalize).toMatch(/'stockunitid', u\.id/);
  });
});

describe("14) validasi pembayaran", () => {
  it("DP, kredit, dan jatuh tempo divalidasi ketat", () => {
    expect(finalize).toMatch(/dp lunas: gunakan metode tunai atau transfer/);
    expect(finalize).toMatch(/kredit tidak menerima pembayaran awal/);
    expect(finalize).toMatch(/_due < current_date then raise/);
    expect(finalize).toMatch(/jumlah dibayar tidak boleh negatif/);
    expect(finalize).toMatch(/jumlah dibayar melebihi total/);
  });
  it("ledger idempoten mengambil ledger yang sudah ada", () => {
    expect(finalize).toMatch(
      /if _ledger is null then\s*select id into _ledger from public\.ledgers where sales_record_id = _rec\.id;/,
    );
  });
});
