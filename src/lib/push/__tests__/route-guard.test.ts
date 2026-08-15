import { describe, expect, it, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const capability = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));
vi.mock("@/lib/api/conversations", () => ({
  fetchConversationCapability: (id: string) => capability(id),
}));

const { guardPushRoute } = await import("../route-guard");
const CONV = "11111111-2222-4333-8444-555555555555";

describe("guardPushRoute", () => {
  beforeEach(() => {
    getSession.mockReset();
    capability.mockReset();
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
  });

  it("mengarahkan ke login bila tidak ada sesi", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await guardPushRoute(`/chat/${CONV}`)).toMatchObject({ route: "/login", blocked: true });
  });

  it("meneruskan rute non-percakapan tanpa cek kapabilitas", async () => {
    expect(await guardPushRoute("/calls")).toEqual({ route: "/calls", blocked: false });
    expect(capability).not.toHaveBeenCalled();
  });

  it("mengizinkan percakapan yang dapat dibaca", async () => {
    capability.mockResolvedValue({ readable: true, reason: "ok" });
    expect(await guardPushRoute(`/chat/${CONV}?m=9`)).toEqual({
      route: `/chat/${CONV}?m=9`,
      blocked: false,
    });
  });

  it("memblokir percakapan tanpa izin baca dan memberi alasan", async () => {
    capability.mockResolvedValue({ readable: false, reason: "not_member" });
    const res = await guardPushRoute(`/chat/${CONV}`);
    expect(res.route).toBe("/chat");
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain("peserta");
  });

  it("tidak mengunci pengguna saat pengecekan gagal", async () => {
    capability.mockRejectedValue(new Error("network"));
    expect(await guardPushRoute(`/chat/${CONV}`)).toEqual({ route: `/chat/${CONV}`, blocked: false });
  });

  it("menolak rute protokol-relatif", async () => {
    expect(await guardPushRoute("//evil.example")).toMatchObject({ route: "/chat", blocked: true });
  });
});
