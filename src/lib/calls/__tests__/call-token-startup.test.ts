import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCallToken } from "../calls.functions";

const livekit = vi.hoisted(() => ({
  readLiveKitConfig: vi.fn(),
  mintAccessToken: vi.fn(),
}));

// Exercise the server handler without HTTP transport or live credentials.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("../livekit.server", () => livekit);

const config = { url: "wss://example.livekit.cloud", apiKey: "key", apiSecret: "secret" };
const participant = { user_id: "user-1", left_at: null as string | null };
const call = { id: "call-1", kind: "video", status: "ongoing", room_name: "room-1" };

function database(options?: {
  participant?: typeof participant | null;
  call?: typeof call | null;
  latency?: { participant: number; call: number; profile: number };
}) {
  const delay = <T>(data: T, ms: number) =>
    new Promise<{ data: T }>((resolve) => setTimeout(() => resolve({ data }), ms));
  const query = <T>(data: T, ms: number) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(() => delay(data, ms)),
    };
    return builder;
  };
  const participantQuery = query(
    options?.participant === undefined ? participant : options.participant,
    options?.latency?.participant ?? 0,
  );
  const callQuery = query(
    options?.call === undefined ? call : options.call,
    options?.latency?.call ?? 0,
  );
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "call_participants") return participantQuery;
      if (table === "calls") return callQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(() => delay({ display_name: "User" }, options?.latency?.profile ?? 0)),
  };
  return { supabase, participantQuery, callQuery };
}

type Handler = (input: {
  data: { callId: string };
  context: { userId: string; supabase: ReturnType<typeof database>["supabase"] };
}) => Promise<unknown>;

const invoke = (db: ReturnType<typeof database>) =>
  (issueCallToken as unknown as Handler)({
    data: { callId: "call-1" },
    context: { userId: "user-1", supabase: db.supabase },
  });

describe("call token startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    livekit.readLiveKitConfig.mockReturnValue(config);
    livekit.mintAccessToken.mockResolvedValue({ token: "signed-token", expiresAt: 900 });
  });

  afterEach(() => vi.useRealTimers());

  it("overlaps independent authorization reads without reading the profile early", async () => {
    const db = database({ latency: { participant: 120, call: 200, profile: 80 } });
    const pending = invoke(db);
    await vi.dynamicImportSettled();

    expect(db.participantQuery.maybeSingle).toHaveBeenCalledOnce();
    expect(db.callQuery.maybeSingle).toHaveBeenCalledOnce();
    expect(db.supabase.rpc).not.toHaveBeenCalled();
    expect(livekit.mintAccessToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(199);
    expect(db.supabase.rpc).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({
      configured: true,
      allowed: true,
      url: config.url,
      token: "signed-token",
      room: "room-1",
      expiresAt: 900,
    });
    expect(db.participantQuery.eq.mock.calls).toEqual([
      ["call_id", "call-1"],
      ["user_id", "user-1"],
    ]);
    expect(db.callQuery.eq).toHaveBeenCalledWith("id", "call-1");
    expect(db.supabase.rpc).toHaveBeenCalledWith("my_profile");
    expect(livekit.mintAccessToken).toHaveBeenCalledWith(config, {
      room: "room-1",
      identity: "user-1",
      name: "User",
      canPublishVideo: true,
      ttlSec: 900,
    });
  });

  it.each([
    { participant: 120, call: 200, profile: 80 },
    { participant: 200, call: 120, profile: 80 },
  ])("takes one authorization round-trip with latencies %j", async (latency) => {
    const db = database({ latency });
    const start = Date.now();
    const pending = invoke(db);
    await vi.dynamicImportSettled();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ allowed: true });
    // Serial baseline: 120 + 200 + 80 = 400 ms. Concurrent: max(120, 200) + 80.
    expect(Date.now() - start).toBe(280);
  });

  it("never mints a token if an authorization read rejects", async () => {
    const db = database();
    db.callQuery.maybeSingle.mockRejectedValueOnce(new Error("database unavailable"));
    const assertion = expect(invoke(db)).rejects.toThrow("database unavailable");
    await vi.dynamicImportSettled();
    await vi.runAllTimersAsync();
    await assertion;
    expect(db.supabase.rpc).not.toHaveBeenCalled();
    expect(livekit.mintAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    { participant: null, call, code: "not_participant" },
    { participant: { ...participant, left_at: "2026-10-21" }, call, code: "already_left" },
    { participant, call: { ...call, status: "ringing" }, code: "call_not_answered" },
    { participant, call: { ...call, status: "ended" }, code: "call_ended" },
    { participant, call: { ...call, room_name: "" }, code: "call_invalid" },
    { participant, call: null, code: "call_invalid" },
  ])("does not read profiles or mint tokens when denied: $code", async (options) => {
    const db = database(options);
    const pending = invoke(db);
    await vi.dynamicImportSettled();
    await vi.runAllTimersAsync();

    expect(await pending).toMatchObject({ configured: true, allowed: false, code: options.code });
    expect(db.supabase.rpc).not.toHaveBeenCalled();
    expect(livekit.mintAccessToken).not.toHaveBeenCalled();
  });

  it("does not query the database when LiveKit is unconfigured", async () => {
    livekit.readLiveKitConfig.mockReturnValue(null);
    const db = database();
    expect(await invoke(db)).toMatchObject({ configured: false });
    expect(db.supabase.from).not.toHaveBeenCalled();
    expect(db.supabase.rpc).not.toHaveBeenCalled();
    expect(livekit.mintAccessToken).not.toHaveBeenCalled();
  });
});
