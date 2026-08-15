import { describe, expect, it } from "vitest";
import {
  answerFailureText,
  connectFailureText,
  describeAnswerFailure,
  describeConnectFailure,
} from "../failure-messages";

describe("pesan kegagalan panggilan", () => {
  it("panggilan yang sudah berakhir tidak menawarkan coba lagi", () => {
    const m = describeAnswerFailure(new Error("Panggilan sudah berakhir"));
    expect(m.outcome).toBe("ended");
    expect(m.action).toMatch(/riwayat panggilan/i);
  });

  it("gagal jawab karena jaringan bisa dicoba ulang", () => {
    expect(describeAnswerFailure(new Error("Failed to fetch")).outcome).toBe("retry");
  });

  it("bukan peserta dijelaskan sebagai akun salah", () => {
    expect(describeAnswerFailure("Anda bukan peserta panggilan ini").outcome).toBe("ended");
  });

  it("izin media ditolak diarahkan ke pengaturan", () => {
    const m = describeConnectFailure("NotAllowedError: Permission denied");
    expect(m.outcome).toBe("permission");
    expect(m.action).toMatch(/pengaturan/i);
  });

  it("perangkat sibuk diarahkan ke ganti perangkat", () => {
    expect(describeConnectFailure("NotReadableError").outcome).toBe("device");
  });

  it("putus jaringan setelah diangkat bisa disambung ulang", () => {
    expect(describeConnectFailure("ICE connection lost").outcome).toBe("retry");
  });

  it("selalu mengembalikan penyebab dan langkah lanjut", () => {
    for (const text of [answerFailureText(null), connectFailureText(undefined)]) {
      expect(text.split(". ").length).toBeGreaterThanOrEqual(2);
      expect(text.length).toBeGreaterThan(20);
    }
  });
});
