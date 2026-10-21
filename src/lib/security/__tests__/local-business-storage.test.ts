import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetSessionScope, scopedKey, setActiveUser } from "@/lib/session-scope";
import { listExportHistory, recordExport } from "@/lib/ledger/export-history";
import { clearSimulation, readSimulation, saveSimulation } from "@/lib/premium/plans";

const entry = {
  receipt: "receipt-a",
  ledgerId: "ledger-a",
  ledgerName: "Private ledger A",
  format: "csv" as const,
  fileName: "payment.csv",
  at: "2026-10-21T00:00:00Z",
};
const simulation = { planId: "monthly" as const, method: "test", at: entry.at };

describe("business storage belongs to the signed-in account", () => {
  beforeEach(() => {
    __resetSessionScope();
    localStorage.clear();
  });
  afterEach(() => {
    __resetSessionScope();
    localStorage.clear();
  });

  it("does not expose or adopt unowned legacy data on login", () => {
    localStorage.setItem("mcm.ledger.export-history.v1", JSON.stringify([entry]));
    localStorage.setItem("mcm.premium.simulation", JSON.stringify(simulation));
    setActiveUser("account-b");
    expect(listExportHistory()).toEqual([]);
    expect(readSimulation()).toBeNull();
    setActiveUser("account-c");
    setActiveUser(null);
    expect(localStorage.getItem("mcm.ledger.export-history.v1")).toBe(JSON.stringify([entry]));
    expect(localStorage.getItem("mcm.premium.simulation")).toBe(JSON.stringify(simulation));
    expect(listExportHistory()).toEqual([]);
    expect(readSimulation()).toBeNull();
  });

  it("isolates export history and simulation across account switches", () => {
    setActiveUser("account-a");
    recordExport(entry);
    saveSimulation(simulation);
    expect(listExportHistory()).toEqual([entry]);
    expect(readSimulation()).toEqual(simulation);
    const historyKey = scopedKey("mcm.ledger.export-history.v1");
    const simulationKey = scopedKey("mcm.premium.simulation");
    setActiveUser("account-b");
    expect(listExportHistory()).toEqual([]);
    expect(readSimulation()).toBeNull();
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(localStorage.getItem(simulationKey)).toBeNull();
  });

  it("never persists business data without a signed-in account", () => {
    recordExport(entry);
    saveSimulation(simulation);
    expect(listExportHistory()).toEqual([]);
    expect(readSimulation()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("clears only the current account simulation and purges on logout", () => {
    setActiveUser("account-a");
    recordExport(entry);
    saveSimulation(simulation);
    clearSimulation();
    expect(readSimulation()).toBeNull();
    expect(listExportHistory()).toEqual([entry]);
    setActiveUser(null);
    expect(listExportHistory()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });
});
