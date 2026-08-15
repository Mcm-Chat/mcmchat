/**
 * Uji aksesibilitas layar panggilan masuk & panel pemulihan.
 *
 * Cakupan tiap state: nama aksesibel (VoiceOver/TalkBack), urutan Tab,
 * Shift+Tab, focus trap, Escape, live region, dan pemulihan fokus ke pemicu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, screen, waitFor } from "@testing-library/react";
import { CallFailureRecovery } from "@/components/mcm/call-failure-recovery";

const navigate = vi.fn();
let ringingRow: any = null;
let incomingCb: ((row: any) => void) | null = null;
let callCb: ((row: any) => void) | null = null;

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouterState: () => "/chat",
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/api/profiles", () => ({
  fetchProfileCard: async () => ({ display_name: "Can", avatar_color: "from-slate-500 to-slate-700" }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/realtime/connection", () => ({ onConnectionChange: () => () => {} }));
vi.mock("@/lib/calls/tones", () => ({ playTone: () => ({ stop: () => {} }) }));
vi.mock("@/lib/contacts/alias", () => ({ useContactAliases: () => ({ nameOf: (_id: string, n: string) => n }) }));
vi.mock("@/lib/calls/return-focus", () => ({ setCallReturnFocus: vi.fn(), redialButtonId: (id: string) => `redial-call-${id}` }));
vi.mock("@/lib/api/calls", () => ({
  RING_TIMEOUT_MS: 45_000,
  ringRemainingMs: () => 45_000,
  declineCall: vi.fn(async () => {}),
  listRingingCalls: async () => (ringingRow ? [ringingRow] : []),
  subscribeIncomingCalls: (_uid: string, cb: (row: any) => void) => {
    incomingCb = cb;
    return () => { incomingCb = null; };
  },
  subscribeCall: (_id: string, cb: (row: any) => void) => {
    callCb = cb;
    return () => { callCb = null; };
  },
}));

import { IncomingCallListener } from "@/components/mcm/incoming-call";

const row = (kind: "audio" | "video" = "audio") => ({
  id: "call-1",
  kind,
  initiator_id: "can",
  status: "ringing",
  created_at: new Date().toISOString(),
});

function tab(shift = false) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true }));
  });
}

async function raf() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function openIncoming(kind: "audio" | "video" = "audio") {
  const trigger = document.createElement("button");
  trigger.textContent = "Panggil ulang";
  document.body.appendChild(trigger);
  trigger.focus();
  render(<IncomingCallListener />);
  await act(async () => {
    incomingCb?.(row(kind));
    await Promise.resolve();
  });
  await raf();
  return trigger;
}

// happy-dom tidak menghitung layout: anggap semua elemen terlihat agar
// filter visibilitas pada focus trap berperilaku seperti di browser nyata.
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get() {
    return this.isConnected ? document.body : null;
  },
});

beforeEach(() => {
  ringingRow = null;
  incomingCb = null;
  callCb = null;
  navigate.mockClear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Banner panggilan masuk — state berdering", () => {
  it("punya dialog modal dengan nama aksesibel dan live region status", async () => {
    await openIncoming("audio");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-label")).toMatch(/panggilan suara masuk dari can/i);
    expect(screen.getByRole("alert", { name: /status panggilan/i })).toBeInTheDocument();
  });

  it("panggilan video memakai label yang tepat", async () => {
    await openIncoming("video");
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toMatch(/panggilan video masuk/i);
  });

  it("fokus awal jatuh ke tombol Jawab (aksi utama)", async () => {
    await openIncoming();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /jawab panggilan/i }));
  });

  it("Tab dan Shift+Tab berputar hanya di antara Jawab dan Tolak", async () => {
    await openIncoming();
    const answer = screen.getByRole("button", { name: /jawab panggilan/i });
    const decline = screen.getByRole("button", { name: /tolak panggilan/i });
    tab();
    expect(document.activeElement).toBe(decline);
    tab();
    expect(document.activeElement).toBe(answer);
    tab(true);
    expect(document.activeElement).toBe(decline);
  });

  it("Escape tidak menolak panggilan (cegah penolakan tak sengaja)", async () => {
    await openIncoming();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Banner panggilan masuk — state penutupan", () => {
  it("menjawab: banner tutup, fokus pulih ke pemicu, pengumuman terbaca", async () => {
    const trigger = await openIncoming();
    act(() => screen.getByRole("button", { name: /jawab panggilan/i }).click());
    await raf();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigate).toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole("status").textContent).toMatch(/panggilan dijawab/i);
  });

  it("menolak: banner tutup dengan pengumuman ditolak dan fokus pulih", async () => {
    const trigger = await openIncoming();
    act(() => screen.getByRole("button", { name: /tolak panggilan/i }).click());
    await raf();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole("status").textContent).toMatch(/ditolak/i);
  });

  it("perubahan status server (tak terjawab) menutup banner dan mengumumkannya", async () => {
    const trigger = await openIncoming();
    await act(async () => {
      callCb?.({ ...row(), status: "missed" });
      await Promise.resolve();
    });
    await raf();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole("status").textContent).toMatch(/tak terjawab/i);
  });
});

describe("Panel pemulihan panggilan gagal", () => {
  function renderPanel(props: Partial<React.ComponentProps<typeof CallFailureRecovery>> = {}) {
    const back = document.createElement("button");
    back.textContent = "Kembali";
    document.body.appendChild(back);
    const onDismiss = vi.fn();
    const utils = render(
      <CallFailureRecovery
        reason={props.reason ?? "NotAllowedError: izin mikrofon ditolak"}
        onRetry={() => {}}
        onOpenDevices={() => {}}
        onOpenProvider={() => {}}
        onDismiss={onDismiss}
        trapFocus
        fallbackFocus={() => back}
        {...props}
      />,
    );
    return { ...utils, back, onDismiss };
  }

  it("adalah alertdialog dengan nama aksesibel dan penyebab ringkas", async () => {
    renderPanel();
    const panel = screen.getByRole("alertdialog", { name: /pemulihan panggilan gagal/i });
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/penyebab: izin mikrofon ditolak/i)).toBeInTheDocument();
  });

  it("state izin: fokus awal ke tombol minta izin lagi", async () => {
    renderPanel();
    await raf();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /minta izin lagi/i }));
  });

  it("state perangkat: aksi Ganti perangkat tampil lebih dulu", async () => {
    renderPanel({ reason: "NotReadableError: mikrofon sedang dipakai aplikasi lain" });
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names.join("|")).toMatch(/ganti perangkat.*coba sambungkan lagi/i);
    expect(screen.getByText(/penyebab: mikrofon dipakai aplikasi lain/i)).toBeInTheDocument();
  });

  it("state penyedia belum siap: penyebab dan urutan aksi sesuai", async () => {
    renderPanel({ reason: null, unconfigured: true });
    expect(screen.getByText(/penyebab: layanan panggilan belum siap/i)).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names.join("|")).toMatch(/ganti penyedia.*coba sambungkan lagi/i);
  });

  it("state jaringan/waktu habis: penyebab ringkas terbaca", async () => {
    renderPanel({ reason: "timeout menunggu join" });
    expect(screen.getByText(/penyebab: waktu join habis/i)).toBeInTheDocument();
  });

  it("Tab berputar di dalam panel (focus trap)", async () => {
    renderPanel();
    await raf();
    const buttons = screen.getAllByRole("button");
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;
    last.focus();
    tab();
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);
  });

  it("Escape menutup panel", async () => {
    const { onDismiss } = renderPanel();
    await raf();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("saat panel dilepas, fokus jatuh ke tombol Kembali", async () => {
    const { unmount, back } = renderPanel();
    await raf();
    unmount();
    await waitFor(() => expect(document.activeElement).toBe(back));
  });

  it("pesan gagal memakai role alert agar dibacakan pembaca layar", async () => {
    renderPanel();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
});
