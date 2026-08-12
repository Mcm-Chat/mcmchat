import { describe, expect, it } from "vitest";
import { isDeadTokenError } from "../fcm.server";

describe("pemangkasan token FCM", () => {
  it("menghapus token yang memang tidak terdaftar", () => {
    expect(isDeadTokenError(404, { error: { status: "NOT_FOUND" } })).toBe(true);
    expect(isDeadTokenError(400, { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "UNREGISTERED" }] } })).toBe(true);
    expect(isDeadTokenError(403, { error: { status: "PERMISSION_DENIED", details: [{ errorCode: "SENDER_ID_MISMATCH" }] } })).toBe(true);
  });

  it("TIDAK menghapus token valid saat payload/kuota bermasalah", () => {
    expect(isDeadTokenError(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid value at 'message.android.priority'" } })).toBe(false);
    expect(isDeadTokenError(429, { error: { status: "QUOTA_EXCEEDED" } })).toBe(false);
    expect(isDeadTokenError(500, { error: { status: "INTERNAL" } })).toBe(false);
    expect(isDeadTokenError(400, null)).toBe(false);
  });

  it("menghapus token bila pesan menyebut registration token tidak valid", () => {
    expect(
      isDeadTokenError(400, { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } }),
    ).toBe(true);
  });
});
