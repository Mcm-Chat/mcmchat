import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup, screen } from "@testing-library/react";
import { ChatComposer } from "@/components/mcm/chat-parts";
import { __resetBackGuard } from "@/lib/mobile/back-guard";

afterEach(() => {
  cleanup();
  __resetBackGuard();
});

function setup() {
  const spies = {
    onAttach: vi.fn(),
    onSticker: vi.fn(),
    onLocation: vi.fn(),
    onNewSale: vi.fn(),
    onNewLedger: vi.fn(),
    onNewPreparation: vi.fn(),
  };
  render(
    <ChatComposer
      value=""
      onChange={() => {}}
      onSend={() => {}}
      onVoice={() => {}}
      onAttach={spies.onAttach}
      onSticker={spies.onSticker}
      onLocation={spies.onLocation}
      onNewSale={spies.onNewSale}
      onNewLedger={spies.onNewLedger}
      onNewPreparation={spies.onNewPreparation}
    />,
  );
  act(() => {
    screen.getByRole("button", { name: /tindakan lain/i }).click();
  });
  return spies;
}

const TILES = [
  "Foto/Kamera",
  "Foto & lokasi",
  "Stiker",
  "Lokasi",
  "Penjualan",
  "Catat Utang/Piutang",
  "Buat Penyiapan",
  "Dokumen",
];

describe("sheet Tindakan", () => {
  it("menampilkan 8 tile aktif bertipe button", () => {
    setup();
    for (const label of TILES) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn.getAttribute("type")).toBe("button");
      expect(btn.hasAttribute("disabled")).toBe(false);
    }
  });

  it.each([
    ["Foto/Kamera", "onAttach", "camera"],
    ["Foto & lokasi", "onAttach", "image"],
    ["Dokumen", "onAttach", "document"],
  ] as const)("tile %s memanggil handler lampiran", (label, _k, kind) => {
    const spies = setup();
    act(() => {
      screen.getByRole("button", { name: label }).click();
    });
    expect(spies.onAttach).toHaveBeenCalledWith(kind);
  });

  it.each([
    ["Stiker", "onSticker"],
    ["Lokasi", "onLocation"],
    ["Penjualan", "onNewSale"],
    ["Catat Utang/Piutang", "onNewLedger"],
    ["Buat Penyiapan", "onNewPreparation"],
  ] as const)("tile %s memanggil %s", (label, key) => {
    const spies = setup();
    act(() => {
      screen.getByRole("button", { name: label }).click();
    });
    expect(spies[key]).toHaveBeenCalledTimes(1);
  });

  it("tile menutup sheet setelah ditekan", () => {
    setup();
    act(() => {
      screen.getByRole("button", { name: "Lokasi" }).click();
    });
    expect(screen.queryByRole("button", { name: "Lokasi" })).toBeNull();
  });
});
