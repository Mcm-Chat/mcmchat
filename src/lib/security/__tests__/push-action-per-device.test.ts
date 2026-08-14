import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dispatch = readFileSync(resolve("src/lib/push/dispatch.server.ts"), "utf8");
const fcm = readFileSync(resolve("src/lib/push/fcm.server.ts"), "utf8");

describe("push action token: satu payload per perangkat", () => {
  it("sender mendukung payload + TTL per pesan", () => {
    expect(fcm).toContain("export async function sendEach");
    expect(fcm).toMatch(/export type PushMessage[\s\S]*data: PushData/);
    expect(fcm).toContain("outcomes");
    // TTL minimum 1 detik (dipakai sisa dering), bukan lantai 30 detik.
    expect(fcm).toContain("Math.max(1, Math.min(86400");
  });

  it("push pesan tidak lagi multicast satu data object", () => {
    const body = dispatch.slice(
      dispatch.indexOf("export async function dispatchMessagePush"),
      dispatch.indexOf("export async function dispatchCallPush"),
    );
    expect(body).toContain("const messages: PushMessage[] = []");
    expect(body).toContain("await sendEach(messages)");
    expect(body).not.toContain("sendPush(");
    expect(body).toContain("ttlSeconds: MESSAGE_ACTION_TTL_SEC");
    // reply hanya dicetak bila canReply
    expect(body).toMatch(/const reply = canReply\s*\n?\s*\?/);
    expect(body).toContain("revokeNotificationActions(orphaned)");
  });

  it("TTL aksi pesan maksimal 10 menit", () => {
    expect(dispatch).toContain("export const MESSAGE_ACTION_TTL_SEC = 600");
  });

  it("push panggilan memakai deadline dering persis dan TTL sisa detik", () => {
    const body = dispatch.slice(
      dispatch.indexOf("export async function dispatchCallPush"),
      dispatch.indexOf("export async function dispatchCallTerminalPush"),
    );
    expect(body).toContain("CALL_ACTION_TTL_SEC * 1000");
    expect(body).toContain("ring_deadline_passed");
    expect(body).toContain("Math.max(1, Math.min(CALL_ACTION_TTL_SEC, remainingSec))");
    expect(body).toContain("await sendEach(messages)");
    expect(body).toContain("answerActionId");
    expect(body).toContain("declineActionId");
    expect(body).toContain("revokeNotificationActions(orphaned)");
  });

  it("terminal call tanpa token aksi dan memakai collapse key call id", () => {
    const body = dispatch.slice(dispatch.indexOf("export async function dispatchCallTerminalPush"));
    const terminal = body.slice(0, body.indexOf("export type EventPush"));
    expect(terminal).toContain("collapseKey: `call-${input.callId}`");
    expect(terminal).not.toContain("mintNotificationAction");
    expect(terminal).not.toContain("Token");
  });

  it("push generik (task/sale/ledger) tetap multicast tanpa token", () => {
    const body = dispatch.slice(dispatch.indexOf("export async function dispatchEventPush"));
    expect(body).toContain("sendPush(");
    expect(body).not.toContain("mintNotificationAction");
  });
});
