import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Matriks peran untuk pesanan chat & unit fisik stok.
 * Definisi terakhir pada urutan migrasi = definisi live.
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const raw = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ");

const sql = raw.replace(/\s+/g, " ").toLowerCase();

/** Potongan definisi terakhir sebuah fungsi/policy, sampai penanda akhir berikutnya. */
function lastBlock(startPattern: RegExp, length = 2600): string {
  const re = new RegExp(startPattern.source, `${startPattern.flags.replace("g", "")}g`);
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) idx = m.index;
  expect(idx, `tidak menemukan ${startPattern}`).toBeGreaterThan(-1);
  return sql.slice(idx, idx + length);
}

const readOrder = lastBlock(/create or replace function public\.chat_order_actor_can_read/);
const manageOrder = lastBlock(/create or replace function public\.chat_order_actor_can_manage/);
const readUnit = lastBlock(/create or replace function public\.current_user_can_read_stock_unit/);
// Cocokkan hanya create_chat_order(jsonb), bukan create_chat_order_with_message.
const createOrder = lastBlock(/create or replace function public\.create_chat_order\(/, 9000);
const dispatch = lastBlock(/create or replace function public\.dispatch_chat_order/, 9000);
const finalize = lastBlock(/create or replace function public\.finalize_chat_order_delivery/, 3000);
const confirm = lastBlock(/create or replace function public\.confirm_chat_order/, 2000);
const cancel = lastBlock(/create or replace function public\.cancel_chat_order/, 2000);
const ordersPolicy = lastBlock(/create policy "chat orders readable"/, 400);
const unitsPolicy = lastBlock(/create policy "stock units readable"/, 400);

describe("matriks baca pesanan chat", () => {
  it("owner/admin boleh, pembeli boleh, pegawai penyiapan yang ditugaskan boleh", () => {
    expect(readOrder).toContain("'owner','admin'");
    expect(readOrder).toContain("o.buyer_user_id = _uid");
    expect(readOrder).toContain("j.chat_order_id = o.id and j.assigned_user_id = _uid");
  });

  it("agent/cashier hanya untuk pesanan yang ditangani atau dibuatnya", () => {
    expect(readOrder).toMatch(
      /'agent','cashier'\s*\)\s*and \(o\.seller_id = _uid or o\.created_by = _uid\)/,
    );
  });

  it("viewer dan anggota generik ditolak: tanpa gate is_business_member", () => {
    expect(readOrder).not.toContain("is_business_member");
    expect(readOrder).not.toContain("'viewer'");
  });

  it("aktor anonim ditolak", () => {
    expect(readOrder).toContain("_uid is not null");
  });
});

describe("matriks kelola pesanan chat", () => {
  it("owner/admin penuh; agent/cashier hanya pesanan miliknya atau yang belum diklaim", () => {
    expect(manageOrder).toContain("'owner','admin'");
    expect(manageOrder).toMatch(
      /'agent','cashier'\s*\)\s*and \(o\.seller_id = _uid or o\.created_by = _uid or o\.seller_id is null\)/,
    );
  });

  it("tidak memakai can_manage_business/is_business_member generik", () => {
    expect(manageOrder).not.toContain("is_business_member");
    expect(manageOrder).not.toContain("can_manage_business");
  });

  it("confirm, dispatch, finalize, dan cancel memakai helper aktor yang sama", () => {
    for (const fn of [confirm, dispatch, finalize, cancel]) {
      expect(fn).toContain("chat_order_actor_can_manage(o.id, _uid)");
    }
    expect(confirm).not.toContain("can_sell_business(o.business_id, _uid)");
    expect(finalize).not.toContain("can_sell_business(o.business_id, _uid)");
    expect(cancel).not.toContain("can_manage_business(o.business_id, _uid)");
  });

  it("pembeli tetap boleh membatalkan hanya pada tahap awal", () => {
    expect(cancel).toContain("o.buyer_user_id is distinct from _uid");
    expect(cancel).toContain("'buyer_requested','seller_confirmed','changes_requested','buyer_approved'");
  });
});

describe("matriks baca unit fisik stok", () => {
  it("owner/admin, aktor pengelola order terkait, assignee job, pembuat unit, pembeli terkirim", () => {
    expect(readUnit).toContain("'owner','admin'");
    expect(readUnit).toContain("chat_order_actor_can_manage(u.chat_order_id, auth.uid())");
    expect(readUnit).toContain("j.id = u.preparation_job_id and j.assigned_user_id = auth.uid()");
    expect(readUnit).toContain("u.created_by = auth.uid()");
    expect(readUnit).toContain("u.customer_user_id = auth.uid() and u.status = 'delivered'");
  });

  it("tidak ada gate anggota bisnis generik (viewer tidak melihat catatan internal)", () => {
    expect(readUnit).not.toContain("is_business_member");
  });

  it("pembeli hanya melihat unit miliknya yang sudah delivered, bukan seluruh unit ordernya", () => {
    expect(readUnit).not.toContain("chat_order_actor_can_read");
  });
});

describe("policy tabel hanya memanggil helper self-scoped", () => {
  it("chat_orders memakai current_user_can_read_chat_order(id)", () => {
    expect(ordersPolicy).toContain("using (public.current_user_can_read_chat_order(id))");
    expect(ordersPolicy).not.toContain("current_user_is_business_member");
  });

  it("variant_stock_units memakai current_user_can_read_stock_unit(id)", () => {
    expect(unitsPolicy).toContain("using (public.current_user_can_read_stock_unit(id))");
    expect(unitsPolicy).not.toContain("current_user_is_business_member");
  });

  it("items dan slots mewarisi akses order", () => {
    expect(sql).toContain("current_user_can_read_chat_order(chat_order_id)");
  });
});

describe("create_chat_order: peran & identitas pembeli", () => {
  it("viewer/anggota non-penjualan ditolak", () => {
    expect(createOrder).toContain("_role := public.business_role_of(_biz, _uid)");
    expect(createOrder).toContain("_seller := _role in ('owner','admin','agent','cashier')");
    expect(createOrder).toContain("if _role is not null and not _seller then");
  });

  it("tidak lagi menganggap setiap anggota bisnis sebagai penjual", () => {
    expect(createOrder).not.toContain("_seller := public.is_business_member");
  });

  it("buyer_user_id payload tidak dipercaya; pembeli diturunkan dari percakapan", () => {
    expect(createOrder).toContain("bc.customer_id into _buyer");
    expect(createOrder).toContain("from public.direct_conversations dc where dc.conversation_id = _conv");
    expect(createOrder).toContain("if _buyer is null then raise exception 'pembeli tidak dapat ditentukan");
    expect(createOrder).toContain("if _claim is not null and _claim <> _buyer then");
  });

  it("pembeli hanya boleh memesan pada percakapan yang terikat bisnis tersebut", () => {
    expect(createOrder).toContain("from public.business_conversations bc where bc.conversation_id = _conv and bc.business_id = _biz and (bc.customer_id = _uid");
  });
});

describe("dispatch_chat_order: target penugasan", () => {
  it("target wajib anggota aktif dengan peran operasional, viewer ditolak", () => {
    expect(dispatch).toContain("if _assigned is null then");
    expect(dispatch).toContain("public.business_role_of(o.business_id, _assigned) is null");
    expect(dispatch).toContain(
      "public.business_role_of(o.business_id, _assigned) not in ('owner','admin','agent','cashier')",
    );
  });

  it("tidak lagi menerima sembarang anggota bisnis", () => {
    expect(dispatch).not.toContain("is_business_member(o.business_id, _assigned)");
  });
});
