import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth";
import { __resetSessionScope, getActiveUserId } from "../session-scope";

const mock = vi.hoisted(() => ({
  onAuth: null as ((event: string, session: unknown) => void) | null,
  getSession: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
  clearChannels: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mock.getSession,
      signOut: mock.signOut,
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        mock.onAuth = callback;
        return { data: { sub: {}, subscription: { unsubscribe: vi.fn() } } };
      },
    },
    rpc: mock.rpc,
    removeAllChannels: mock.clearChannels,
  },
}));
vi.mock("@/lib/api/pins", () => ({ myPin: async () => "1234" }));
vi.mock("@/lib/api/avatar", () => ({ __resetAvatarCache: vi.fn() }));
vi.mock("@/lib/api/storage", () => ({ clearSignedUrlCache: vi.fn() }));
vi.mock("@/lib/api/outbox", () => ({ resetOutboxForAccount: vi.fn() }));
vi.mock("@/lib/push/native", () => ({ revokeNativePush: async () => {} }));
vi.mock("@/lib/push/web", () => ({ revokeWebPush: async () => {} }));
vi.mock("@/lib/settings/use-settings", () => ({
  useUserSettings: (uid?: string) => ({ settings: uid ? { user_id: uid, theme: "dark" } : null }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const session = (id: string) => ({ user: { id } });
function Probe() {
  const auth = useAuth();
  return (
    <>
      <span data-testid="user">{auth.user?.id ?? "none"}</span>
      <span data-testid="profile">{auth.profile?.id ?? "none"}</span>
      <span data-testid="settings">{auth.settings?.user_id ?? "none"}</span>
      <button onClick={() => void auth.signOut().catch(mock.error)}>Sign out</button>
    </>
  );
}
const app = () => (
  <AuthProvider>
    <Probe />
  </AuthProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  __resetSessionScope();
  mock.onAuth = null;
  mock.getSession.mockResolvedValue({ data: { session: null } });
  mock.rpc.mockResolvedValue({ data: null });
  mock.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  __resetSessionScope();
});

describe("auth account settings", () => {
  it("discards an earlier account's profile request after switching accounts", async () => {
    const a = deferred<{ data: { id: string } }>();
    const b = deferred<{ data: { id: string } }>();
    mock.rpc.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    render(app());
    await act(async () => {
      mock.onAuth?.("SIGNED_IN", session("a"));
    });
    await act(async () => {
      mock.onAuth?.("SIGNED_IN", session("b"));
    });
    await act(async () => b.resolve({ data: { id: "b" } }));
    expect(screen.getByTestId("profile")).toHaveTextContent("b");
    await act(async () => a.resolve({ data: { id: "a" } }));
    expect(screen.getByTestId("profile")).toHaveTextContent("b");
    expect(screen.getByTestId("user")).toHaveTextContent("b");
    expect(screen.getByTestId("settings")).toHaveTextContent("b");
    expect(getActiveUserId()).toBe("b");
  });

  it("does not let a stale initial session override a more recent auth event", async () => {
    const initial = deferred<{ data: { session: ReturnType<typeof session> } }>();
    mock.getSession.mockReturnValueOnce(initial.promise);
    mock.rpc.mockResolvedValue({ data: { id: "b" } });
    render(app());
    await act(async () => {
      mock.onAuth?.("SIGNED_IN", session("b"));
    });
    await act(async () => initial.resolve({ data: { session: session("a") } }));
    expect(screen.getByTestId("user")).toHaveTextContent("b");
    expect(screen.getByTestId("profile")).toHaveTextContent("b");
  });

  it("reports sign-out failure and keeps the current account usable", async () => {
    mock.getSession.mockResolvedValue({ data: { session: session("a") } });
    mock.rpc.mockResolvedValue({ data: { id: "a" } });
    mock.signOut.mockResolvedValue({ error: { message: "network failure" } });
    render(app());
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("a"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledOnce());
    expect(screen.getByTestId("user")).toHaveTextContent("a");
    expect(screen.getByTestId("profile")).toHaveTextContent("a");
    expect(getActiveUserId()).toBe("a");
  });
});
