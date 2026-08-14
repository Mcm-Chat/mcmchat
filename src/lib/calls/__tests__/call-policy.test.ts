import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canIssueCallToken,
  canJoinRoom,
  isEndReason,
  resolveEndOutcome,
  resolveLeaveOutcome,
} from "../policy";
import { buildTokenPayload, isValidLiveKitUrl, validateLiveKitConfig } from "../livekit.server";
import { DIAGNOSTIC_TTL_SEC } from "../diagnostics.functions";

const cfg = { url: "wss://x.livekit.cloud", apiKey: "k", apiSecret: "s" };

describe("kebijakan masuk room", () => {
  it("menolak join saat panggilan masih berdering", () => {
    expect(canJoinRoom("ringing")).toEqual({ allowed: false, code: "call_not_answered" });
  });

  it("mengizinkan join hanya saat ongoing", () => {
    expect(canJoinRoom("ongoing").allowed).toBe(true);
    for (const s of ["ended", "missed", "declined", "failed"] as const)
      expect(canJoinRoom(s)).toEqual({ allowed: false, code: "call_ended" });
  });
});

describe("penerbitan token panggilan", () => {
  const base = { participantExists: true, participantLeft: false, hasRoom: true };

  it("tidak menerbitkan token untuk panggilan ringing", () => {
    expect(canIssueCallToken({ ...base, status: "ringing" })).toEqual({
      allowed: false,
      code: "call_not_answered",
    });
  });

  it("menerbitkan token untuk panggilan ongoing", () => {
    expect(canIssueCallToken({ ...base, status: "ongoing" }).allowed).toBe(true);
  });

  it("menolak peserta yang sudah keluar dan bukan peserta", () => {
    expect(canIssueCallToken({ ...base, status: "ongoing", participantLeft: true }).code).toBe(
      "already_left",
    );
    expect(canIssueCallToken({ ...base, status: "ongoing", participantExists: false }).code).toBe(
      "not_participant",
    );
    expect(canIssueCallToken({ ...base, status: "ongoing", hasRoom: false }).code).toBe(
      "call_invalid",
    );
  });
});

describe("alasan berakhirnya panggilan", () => {
  it("timeout 45 detik => missed/timeout", () => {
    expect(
      resolveEndOutcome({
        status: "ringing",
        isInitiator: true,
        requested: "missed",
        reason: "timeout",
      }),
    ).toEqual({ status: "missed", reason: "timeout" });
  });

  it("pemanggil menutup sebelum dijawab => ended/cancelled", () => {
    expect(
      resolveEndOutcome({ status: "ringing", isInitiator: true, requested: "ended", reason: null }),
    ).toEqual({ status: "ended", reason: "cancelled" });
  });

  it("penerima menolak => declined/declined", () => {
    expect(
      resolveEndOutcome({
        status: "ringing",
        isInitiator: false,
        requested: "declined",
        reason: "declined",
      }),
    ).toEqual({ status: "declined", reason: "declined" });
  });

  it("tutup saat panggilan berlangsung => ended/hangup", () => {
    expect(
      resolveEndOutcome({ status: "ongoing", isInitiator: true, requested: "ended", reason: null }),
    ).toEqual({ status: "ended", reason: "hangup" });
  });

  it("hanya kode alasan resmi yang diterima", () => {
    expect(isEndReason("cancelled")).toBe(true);
    expect(isEndReason("Tidak dijawab")).toBe(false);
  });
});

describe("keluar dari panggilan grup", () => {
  it("peserta grup keluar tidak mengakhiri panggilan", () => {
    expect(
      resolveLeaveOutcome({
        status: "ongoing",
        isInitiator: false,
        totalParticipants: 4,
        activeAfterLeave: 2,
      }),
    ).toEqual({ endsCall: false, outcome: null });
  });

  it("pemanggil grup keluar mengakhiri panggilan", () => {
    expect(
      resolveLeaveOutcome({
        status: "ongoing",
        isInitiator: true,
        totalParticipants: 4,
        activeAfterLeave: 2,
      }),
    ).toEqual({ endsCall: true, outcome: { status: "ended", reason: "hangup" } });
  });

  it("panggilan 1:1 selalu berakhir dan pembatalan tercatat cancelled", () => {
    expect(
      resolveLeaveOutcome({
        status: "ringing",
        isInitiator: true,
        totalParticipants: 2,
        activeAfterLeave: 1,
      }),
    ).toEqual({ endsCall: true, outcome: { status: "ended", reason: "cancelled" } });
  });

  it("peserta terakhir keluar mengakhiri panggilan", () => {
    expect(
      resolveLeaveOutcome({
        status: "ongoing",
        isInitiator: false,
        totalParticipants: 5,
        activeAfterLeave: 0,
      }).endsCall,
    ).toBe(true);
  });
});

describe("konfigurasi penyedia", () => {
  it("URL wajib wss://", () => {
    expect(isValidLiveKitUrl("wss://x.livekit.cloud")).toBe(true);
    expect(isValidLiveKitUrl("https://x.livekit.cloud")).toBe(false);
    expect(isValidLiveKitUrl("bukan-url")).toBe(false);
  });

  it("tiga string terisi tidak cukup bila URL malformed", () => {
    expect(validateLiveKitConfig({ url: "livekit.cloud", apiKey: "k", apiSecret: "s" })).toEqual({
      ok: false,
      code: "provider_url_invalid",
    });
    expect(validateLiveKitConfig({ url: "wss://a.b", apiKey: "k", apiSecret: "" }).ok).toBe(false);
    expect(validateLiveKitConfig({ url: "wss://a.b", apiKey: "k", apiSecret: "s" }).ok).toBe(true);
  });
});

describe("token diagnostik", () => {
  const now = 1_700_000_000;
  const payload = buildTokenPayload(
    cfg,
    {
      room: "mcm-diag-abc",
      identity: "diag-1",
      name: "Diagnostik",
      canPublishVideo: false,
      observerOnly: true,
      ttlSec: DIAGNOSTIC_TTL_SEC,
    },
    now,
  );

  it("tidak boleh publish, subscribe, atau kirim data", () => {
    expect(payload.video.canPublish).toBe(false);
    expect(payload.video.canSubscribe).toBe(false);
    expect(payload.video.canPublishData).toBe(false);
    expect(payload.video.canPublishSources).toEqual([]);
  });

  it("berumur paling lama 60 detik", () => {
    expect(payload.exp - now).toBeLessThanOrEqual(60);
    expect(DIAGNOSTIC_TTL_SEC).toBeLessThanOrEqual(60);
  });

  it("token panggilan nyata tetap boleh publish audio", () => {
    const p = buildTokenPayload(
      cfg,
      { room: "r", identity: "u", name: "U", canPublishVideo: false },
      now,
    );
    expect(p.video.canPublish).toBe(true);
    expect(p.video.canPublishSources).toEqual(["microphone"]);
  });
});

describe("Android App Link panggilan", () => {
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

  it("memuat /call untuk mcmchat.id dan www.mcmchat.id", () => {
    for (const host of ["mcmchat.id", "www.mcmchat.id"])
      expect(manifest).toContain(`android:host="${host}" android:pathPrefix="/call"`);
  });
});
