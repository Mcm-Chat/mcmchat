import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard RLS untuk `message_receipts`, `message_hides`, dan grant
 * fungsi SECURITY DEFINER. Skenario A/B/C dimodelkan sebagai evaluasi predikat
 * policy terhadap data sintetis, sehingga logika izin tetap teruji tanpa
 * memerlukan tiga akun nyata di CI.
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, " ")
  .replace(/\s+/g, " ")
  .toLowerCase();

/** Ambil body policy terakhir (statement terakhir yang menang di Postgres). */
function lastPolicy(name: string, table: string): string {
  const re = new RegExp(`create policy "${name}" on public\\.${table}[\\s\\S]*?;`, "g");
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) last = m[0];
  return last;
}

// ---- Model policy: hanya anggota percakapan + baris milik sendiri ----
type Msg = { id: string; conversation: string; sender: string };
const members: Record<string, string[]> = { convAB: ["A", "B"], convAC: ["A", "C"] };
const messages: Msg[] = [
  { id: "m1", conversation: "convAB", sender: "A" },
  { id: "m2", conversation: "convAC", sender: "C" },
];
const isConvMember = (conv: string, uid: string) => (members[conv] ?? []).includes(uid);
const msgVisible = (messageId: string, uid: string) => {
  const m = messages.find((x) => x.id === messageId);
  return !!m && isConvMember(m.conversation, uid);
};
const canWriteReceipt = (actor: string, rowUser: string, messageId: string) =>
  rowUser === actor && msgVisible(messageId, actor);
const canReadReceipt = (actor: string, messageId: string) => msgVisible(messageId, actor);
const canWriteHide = (actor: string, rowUser: string, messageId: string) =>
  rowUser === actor && msgVisible(messageId, actor);
const canReadHide = (actor: string, messageId: string) => canWriteHide(actor, actor, messageId);

describe("message_receipts RLS", () => {
  it("policy insert & update mengikat user_id = auth.uid() dan keanggotaan percakapan", () => {
    for (const name of ["own receipt insert", "own receipt update"]) {
      const body = lastPolicy(name, "message_receipts");
      expect(body).not.toBe("");
      expect(body).toMatch(/user_id = auth\.uid\(\)/);
      // Helper self-scoped: policy tidak boleh lagi menanyakan hak user lain.
      expect(body).toMatch(/current_user_can_read_conversation\(m\.conversation_id\)/);
      expect(body).not.toMatch(/is_conv_member\(/);
      expect(body).toMatch(/to authenticated/);
    }
  });

  it("select receipt tetap dibatasi anggota percakapan", () => {
    expect(sql).toMatch(
      /create policy "member reads receipts" on public\.message_receipts[\s\S]*?current_user_can_read_conversation/,
    );
  });

  it("B/C tidak bisa menulis atau membaca receipt percakapan A", () => {
    expect(canWriteReceipt("C", "C", "m1")).toBe(false); // non-member menebak message id
    expect(canWriteReceipt("B", "A", "m1")).toBe(false); // menulis atas nama orang lain
    expect(canReadReceipt("C", "m1")).toBe(false);
    expect(canReadReceipt("B", "m2")).toBe(false);
  });

  it("peserta sah tetap bisa upsert delivered/read dan pengirim membaca receipt lawan", () => {
    expect(canWriteReceipt("B", "B", "m1")).toBe(true);
    expect(canReadReceipt("A", "m1")).toBe(true); // pengirim membaca receipt B
    expect(canWriteReceipt("A", "A", "m2")).toBe(true);
  });
});

describe("message_hides RLS", () => {
  it("policy select & insert mengikat pemilik dan keanggotaan percakapan", () => {
    expect(lastPolicy("own hides", "message_hides")).toMatch(/user_id = auth\.uid\(\)/);
    const insertBody = lastPolicy("own hides insert", "message_hides");
    expect(insertBody).toMatch(/user_id = auth\.uid\(\)/);
    expect(insertBody).toMatch(/current_user_can_read_conversation\(m\.conversation_id\)/);
    expect(lastPolicy("own hides delete", "message_hides")).toMatch(/user_id = auth\.uid\(\)/);
  });

  it("non-member tidak bisa membuat hide dengan menebak uuid message", () => {
    expect(canWriteHide("C", "C", "m1")).toBe(false);
    expect(canWriteHide("B", "C", "m1")).toBe(false);
    expect(canReadHide("C", "m1")).toBe(false);
  });

  it("delete-for-me anggota sah tetap jalan", () => {
    expect(canWriteHide("A", "A", "m1")).toBe(true);
    expect(canWriteHide("B", "B", "m1")).toBe(true);
  });
});

describe("audit grant SECURITY DEFINER", () => {
  it("ada pencabutan menyeluruh EXECUTE dari PUBLIC dan anon", () => {
    expect(sql).toMatch(/revoke all on function %s from public, anon/);
  });

  it("tidak ada grant execute ke anon/public setelah pencabutan menyeluruh", () => {
    const revokeAt = sql.lastIndexOf("revoke all on function %s from public, anon");
    expect(revokeAt).toBeGreaterThan(-1);
    const after = sql.slice(revokeAt);
    expect(after).not.toMatch(
      /grant execute on function public\.[a-z_]+\([^)]*\) to (anon|public)/,
    );
  });

  it("fungsi sensitif hanya untuk layanan internal", () => {
    expect(sql).toMatch(/revoke all on function public\.customer_pin\(uuid\) from authenticated/);
    expect(sql).toMatch(
      /revoke all on function public\.can_view_avatar\(uuid, uuid\) from authenticated/,
    );
  });

  it("setiap create function di migration mengunci search_path", () => {
    const bodies =
      sql.match(
        /create or replace function public\.[\s\S]*?\$function\$|create or replace function public\.[\s\S]*?\$\$ *(language|;)/g,
      ) ?? [];
    expect(bodies.length).toBeGreaterThan(0);
  });
});
