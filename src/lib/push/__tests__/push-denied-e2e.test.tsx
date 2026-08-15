/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regresi end-to-end guard izin push: payload notifikasi → guard kapabilitas →
 * modal penjelasan → rute pengganti. Semua skenario penolakan diuji utuh
 * (sesi habis, dikeluarkan, diblokir, percakapan hilang, tautan tidak sah),
 * termasuk jalur web listener agar delivered-mark tidak jalan saat ditolak.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const getSession = vi.fn();
const capability = vi.fn();
const rpc = vi.fn();
const navigate = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: () => getSession() }, rpc: (...a: any[]) => rpc(...a) },
}));
vi.mock("@/lib/api/conversations", () => ({
  fetchConversationCapability: (id: string) => capability(id),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const { guardPushRoute, announceGuardResult } = await import("../route-guard");
const { PushDeniedDialog } = await import("@/components/mcm/push-denied-dialog");

const CONV = "11111111-2222-4333-8444-555555555555";

/** Jalankan alur lengkap seperti klik notifikasi lalu tutup modalnya. */
async function runPushClick(route: string) {
  render(<PushDeniedDialog />);
  const guarded = await guardPushRoute(route);
  act(() => announceGuardResult(guarded));
  return guarded;
}

describe("regresi guard izin push (end-to-end)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    getSession.mockReset();
    capability.mockReset();
    rpc.mockReset();
    navigate.mockReset();
    navigate.mockResolvedValue(undefined);
    rpc.mockResolvedValue({ data: null, error: null });
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    // Emitter meredam duplikat 3 detik; geser waktu antar-skenario.
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 + Math.floor(Math.random() * 1e9));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const cases: Array<{
    name: string;
    setup: () => void;
    route: string;
    code: string;
    fallback: string;
    titleRe: RegExp;
  }> = [
    {
      name: "sesi habis",
      setup: () => getSession.mockResolvedValue({ data: { session: null } }),
      route: `/chat/${CONV}`,
      code: "no_session",
      fallback: "/login",
      titleRe: /sesi/i,
    },
    {
      name: "dikeluarkan dari grup",
      setup: () => capability.mockResolvedValue({ readable: false, reason: "removed" }),
      route: `/chat/${CONV}`,
      code: "removed",
      fallback: "/chat",
      titleRe: /dikeluarkan/i,
    },
    {
      name: "diblokir",
      setup: () => capability.mockResolvedValue({ readable: false, reason: "blocked" }),
      route: `/chat/${CONV}?m=9`,
      code: "blocked",
      fallback: "/chat",
      titleRe: /diblokir/i,
    },
    {
      name: "bukan peserta",
      setup: () => capability.mockResolvedValue({ readable: false, reason: "not_member" }),
      route: `/chat/${CONV}`,
      code: "not_member",
      fallback: "/chat",
      titleRe: /peserta/i,
    },
    {
      name: "percakapan hilang",
      setup: () => capability.mockResolvedValue({ readable: false, reason: "missing" }),
      route: `/chat/${CONV}`,
      code: "missing",
      fallback: "/chat",
      titleRe: /tidak ada/i,
    },
    {
      name: "tautan tidak sah",
      setup: () => undefined,
      route: "//evil.example/chat",
      code: "invalid_route",
      fallback: "/chat",
      titleRe: /tidak sah/i,
    },
    {
      name: "alasan tak dikenal",
      setup: () => capability.mockResolvedValue({ readable: false, reason: "weird_state" }),
      route: `/chat/${CONV}`,
      code: "unknown",
      fallback: "/chat",
      titleRe: /ditolak/i,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: modal tampil, rute pengganti ${c.fallback}`, async () => {
      c.setup();
      const guarded = await runPushClick(c.route);

      expect(guarded.blocked).toBe(true);
      expect(guarded.code).toBe(c.code);
      expect(guarded.route).toBe(c.fallback);

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(c.titleRe);
      expect(screen.getByText(guarded.reason!)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /mengerti/i }));
      await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: c.fallback, replace: true }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });
  }

  it("percakapan yang boleh dibaca: tanpa modal, rute asli dipertahankan", async () => {
    capability.mockResolvedValue({ readable: true, reason: "ok" });
    const guarded = await runPushClick(`/chat/${CONV}?m=12`);
    expect(guarded).toMatchObject({ blocked: false, route: `/chat/${CONV}?m=12` });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("gagal jaringan tidak mengunci pemilik sah", async () => {
    capability.mockRejectedValue(new Error("offline"));
    const guarded = await runPushClick(`/chat/${CONV}`);
    expect(guarded).toMatchObject({ blocked: false, route: `/chat/${CONV}` });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("rute non-percakapan lolos tanpa cek kapabilitas", async () => {
    const guarded = await runPushClick("/calls");
    expect(guarded).toMatchObject({ blocked: false, route: "/calls" });
    expect(capability).not.toHaveBeenCalled();
  });
});

describe("jalur web listener saat guard menolak", () => {
  let listener: ((e: any) => void) | null = null;
  const closed: string[] = [];

  beforeEach(async () => {
    getSession.mockReset();
    capability.mockReset();
    rpc.mockReset();
    listener = null;
    closed.length = 0;
    rpc.mockResolvedValue({ data: null, error: null });
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    (globalThis as any).PushManager = function PushManager() {};
    (globalThis as any).Notification = function Notification() {};
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: (_t: string, fn: any) => (listener = fn),
        removeEventListener: () => undefined,
        getRegistration: async () => ({
          getNotifications: async () => [{ close: () => closed.push("x") }],
        }),
      },
    });
  });

  it("tidak menandai delivered dan menavigasi ke /chat saat ditolak", async () => {
    capability.mockResolvedValue({ readable: false, reason: "blocked" });
    const { attachWebPushListeners } = await import("../web");
    const navigateTo = vi.fn();
    const detach = attachWebPushListeners(navigateTo);
    expect(listener).toBeTypeOf("function");

    const ack = vi.fn();
    listener!({
      data: { type: "mcm-push-route", route: `/chat/${CONV}` },
      ports: [{ postMessage: ack }],
    });

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("/chat"));
    expect(ack).toHaveBeenCalledWith({ type: "mcm-push-route-ack" });
    expect(rpc).not.toHaveBeenCalled();
    expect(closed).toHaveLength(0);
    detach();
  });

  it("menandai delivered dan menutup notifikasi saat diizinkan", async () => {
    capability.mockResolvedValue({ readable: true, reason: "ok" });
    const { attachWebPushListeners } = await import("../web");
    const navigateTo = vi.fn();
    const detach = attachWebPushListeners(navigateTo);
    listener!({
      data: { type: "mcm-push-route", route: `/chat/${CONV}` },
      ports: [{ postMessage: vi.fn() }],
    });

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith(`/chat/${CONV}`));
    expect(rpc).toHaveBeenCalledWith("mark_messages_delivered", { _conv: CONV });
    expect(closed).toHaveLength(1);
    detach();
  });
});
