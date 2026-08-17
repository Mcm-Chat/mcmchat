import { describe, expect, it } from "vitest";
import { resolveAppLink } from "../app-link";

describe("resolveAppLink", () => {
  it("membuka chat dari App Link mcmchat.id", () => {
    expect(resolveAppLink("https://mcmchat.id/chat/abc?m=1")).toBe("/chat/abc?m=1");
  });

  it("membuka permintaan kontak dari tautan PIN", () => {
    expect(resolveAppLink("https://www.mcmchat.id/contact/A2B3-C4D5")).toBe(
      "/contacts/add?pin=A2B3-C4D5",
    );
  });

  it("menolak PIN tidak valid", () => {
    expect(resolveAppLink("https://mcmchat.id/contact/xx")).toBeNull();
  });

  it("mendukung skema aplikasi mcm://", () => {
    expect(resolveAppLink("mcm://call/xyz")).toBe("/call/xyz");
  });

  it("menolak host asing dan bagian yang tidak ada", () => {
    expect(resolveAppLink("https://contoh.com/chat/abc")).toBeNull();
    expect(resolveAppLink("https://mcmchat.id/entah")).toBeNull();
  });

  it("mengembalikan beranda untuk tautan akar", () => {
    expect(resolveAppLink("https://mcmchat.id/")).toBe("/");
  });
});
