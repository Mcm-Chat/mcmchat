import { describe, expect, it, vi } from "vitest";
import {
  HandshakeTimeoutError,
  handshakeDelayMs,
  handshakeProgressText,
  isPermanentHandshakeError,
  withHandshakeRetry,
  withHandshakeTimeout,
} from "../handshake";

const noSleep = async () => undefined;

describe("retry handshake panggilan", () => {
  it("berhasil pada percobaan kedua setelah gagal jaringan", async () => {
    let n = 0;
    const attempts: number[] = [];
    const out = await withHandshakeRetry(
      async () => {
        n += 1;
        if (n === 1) throw new Error("ICE connection failed");
        return "session";
      },
      { sleepFn: noSleep, onAttempt: (a) => attempts.push(a) },
    );
    expect(out).toBe("session");
    expect(n).toBe(2);
    expect(attempts).toEqual([1, 2]);
  });

  it("tidak mengulang kegagalan permanen", async () => {
    let n = 0;
    await expect(
      withHandshakeRetry(
        async () => {
          n += 1;
          throw new Error("NotAllowedError: permission denied");
        },
        { sleepFn: noSleep },
      ),
    ).rejects.toThrow(/denied/i);
    expect(n).toBe(1);
  });

  it("berhenti setelah batas percobaan", async () => {
    let n = 0;
    await expect(
      withHandshakeRetry(
        async () => {
          n += 1;
          throw new Error("network timeout");
        },
        { sleepFn: noSleep, attempts: 3 },
      ),
    ).rejects.toThrow();
    expect(n).toBe(3);
  });

  it("berhenti saat panggilan dibatalkan", async () => {
    let ended = false;
    let n = 0;
    await expect(
      withHandshakeRetry(
        async () => {
          n += 1;
          ended = true;
          throw new Error("network");
        },
        { sleepFn: noSleep, isAborted: () => ended },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });

  it("membersihkan sesi setengah jadi sebelum percobaan ulang", async () => {
    const cleaned: number[] = [];
    let n = 0;
    await withHandshakeRetry(
      async () => {
        n += 1;
        if (n === 1) throw new Error("signalling timeout");
        return true;
      },
      { sleepFn: noSleep, onRetry: (_e, next) => void cleaned.push(next) },
    );
    expect(cleaned).toEqual([2]);
  });

  it("jeda naik secara eksponensial", () => {
    const r = () => 0;
    expect(handshakeDelayMs(1, r)).toBe(800);
    expect(handshakeDelayMs(2, r)).toBe(1600);
    expect(handshakeDelayMs(3, r)).toBe(3200);
  });

  it("percobaan yang menggantung dihentikan oleh tenggat waktu", async () => {
    vi.useFakeTimers();
    const p = withHandshakeTimeout(() => new Promise(() => undefined), 50);
    const assertion = expect(p).rejects.toBeInstanceOf(HandshakeTimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });

  it("izin ditolak permanen, jaringan sementara", () => {
    expect(isPermanentHandshakeError(new Error("Panggilan sudah berakhir"))).toBe(true);
    expect(isPermanentHandshakeError(new Error("failed to fetch"))).toBe(false);
  });

  it("pesan progres menyebut nomor percobaan", () => {
    expect(handshakeProgressText(1, 3)).toMatch(/menyambungkan/i);
    expect(handshakeProgressText(2, 3)).toMatch(/2 dari 3/);
  });
});
