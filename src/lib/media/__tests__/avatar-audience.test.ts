import { describe, expect, it } from "vitest";
import {
  audienceModeFor,
  audienceSummary,
  filterAudienceCandidates,
  needsAudience,
  requiresEmptyConfirm,
  toggleSelection,
} from "../avatar-audience";

describe("avatar audience rules", () => {
  it("memetakan pilihan privasi ke mode audiens", () => {
    expect(audienceModeFor("contacts_except")).toBe("except");
    expect(audienceModeFor("only_share")).toBe("only");
    expect(audienceModeFor("contacts")).toBeNull();
    expect(audienceModeFor("nobody")).toBeNull();
  });

  it("hanya mode berbasis daftar yang butuh pemilih kontak", () => {
    expect(needsAudience("contacts_except")).toBe(true);
    expect(needsAudience("only_share")).toBe(true);
    expect(needsAudience("contacts")).toBe(false);
  });

  it("only_share kosong harus dikonfirmasi, contacts_except tidak", () => {
    expect(requiresEmptyConfirm("only_share", 0)).toBe(true);
    expect(requiresEmptyConfirm("only_share", 1)).toBe(false);
    expect(requiresEmptyConfirm("contacts_except", 0)).toBe(false);
  });

  it("menjelaskan 0 dikecualikan secara eksplisit", () => {
    expect(audienceSummary("contacts_except", 0)).toContain("0 dikecualikan");
    expect(audienceSummary("contacts_except", 3)).toBe("3 dikecualikan");
    expect(audienceSummary("only_share", 0)).toContain("tidak seorang pun");
    expect(audienceSummary("only_share", 2)).toBe("2 dipilih");
  });

  it("mencari berdasarkan nama atau PIN tanpa peka huruf", () => {
    const items = [
      { display_name: "Budi Santoso", pin: "MCM-1111" },
      { display_name: "Citra", pin: "MCM-2222" },
    ];
    expect(filterAudienceCandidates(items, "budi")).toHaveLength(1);
    expect(filterAudienceCandidates(items, "2222")).toHaveLength(1);
    expect(filterAudienceCandidates(items, "   ")).toHaveLength(2);
    expect(filterAudienceCandidates(items, "zzz")).toHaveLength(0);
  });

  it("toggle seleksi tidak menghasilkan duplikat", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a"], "a")).toEqual([]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});
