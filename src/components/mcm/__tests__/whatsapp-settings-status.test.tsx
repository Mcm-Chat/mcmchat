import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { WhatsAppSettingsStatus } from "../whatsapp-settings-status";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props} />
  ),
}));

afterEach(cleanup);

describe("WhatsApp settings capability boundary", () => {
  it("explains build capability without claiming to have checked the user's account", () => {
    render(<WhatsAppSettingsStatus />);
    const section = screen.getByRole("region", { name: "WhatsApp Business" });
    expect(within(section).getByText(/konektor akun belum tersedia/i)).toBeInTheDocument();
    expect(
      within(section).getByText(/koneksi ke TOKOLINK: belum dapat diperiksa/i),
    ).toBeInTheDocument();
    expect(within(section).queryByRole("switch")).toBeNull();
    expect(within(section).queryByRole("textbox")).toBeNull();
    expect(within(section).queryByRole("button", { name: /hubungkan|sambungkan/i })).toBeNull();
  });

  it("distinguishes device sharing from inbox synchronization and automatic connection", () => {
    render(<WhatsAppSettingsStatus />);
    expect(screen.getByText(/fitur bagikan memakai menu berbagi perangkat/i)).toHaveTextContent(
      /tidak menyinkronkan kotak masuk, riwayat pesan, atau panggilan/i,
    );
    expect(
      screen.getByText(/tidak menautkan akun ke TOKOLINK secara otomatis/i),
    ).toBeInTheDocument();
  });

  it("offers a safe official account-management link and a working support destination", () => {
    render(<WhatsAppSettingsStatus />);
    const manager = screen.getByRole("link", { name: /WhatsApp Manager/i });
    expect(manager).toHaveAttribute("href", "https://business.facebook.com/wa/manage/home/");
    expect(manager).toHaveAttribute("target", "_blank");
    expect(manager).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "Pusat bantuan" })).toHaveAttribute("href", "/support");
  });
});
