import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
vi.mock("../chat", () => ({ sendMessage: (...args: unknown[]) => sendMessage(...args) }));
vi.mock("@/lib/realtime/connection", () => ({
  getConnectionState: () => "online",
  onConnectionChange: () => () => undefined,
  backoffDelay: () => 1,
}));

import { __resetOutbox, enqueueText, outboxFor, retryEntry } from "../outbox";

const flush = () => new Promise((r) => setTimeout(r, 5));

describe("outbox", () => {
  beforeEach(() => {
    __resetOutbox();
    sendMessage.mockReset();
  });

  it("mengirim dengan clientId dan mengosongkan antrean saat berhasil", async () => {
    sendMessage.mockResolvedValue({ id: "m1" });
    const entry = enqueueText({ conversationId: "c1", senderId: "u1", body: "halo" });
    await flush();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ clientId: entry.clientId, body: "halo" }));
    expect(outboxFor("c1")).toHaveLength(0);
  });

  it("mempertahankan pesan gagal dan menandainya untuk dicoba ulang", async () => {
    sendMessage.mockRejectedValue(new Error("Koneksi bermasalah. Coba lagi."));
    enqueueText({ conversationId: "c1", senderId: "u1", body: "gagal" });
    await flush();
    const items = outboxFor("c1");
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("failed");
  });

  it("tidak menduplikasi pesan bila server menolak karena kunci idempotensi sama", async () => {
    sendMessage.mockRejectedValueOnce(new Error("duplicate key value violates unique constraint"));
    const entry = enqueueText({ conversationId: "c1", senderId: "u1", body: "sekali" });
    await flush();
    expect(outboxFor("c1")).toHaveLength(0);
    retryEntry(entry.clientId);
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("mengirim ulang memakai clientId yang sama", async () => {
    sendMessage.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ id: "m2" });
    const entry = enqueueText({ conversationId: "c2", senderId: "u1", body: "ulang" });
    await flush();
    retryEntry(entry.clientId);
    await flush();
    const calls = sendMessage.mock.calls.map((c) => (c[0] as { clientId: string }).clientId);
    expect(new Set(calls).size).toBe(1);
    expect(outboxFor("c2")).toHaveLength(0);
  });
});