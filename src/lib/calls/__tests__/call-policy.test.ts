import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canIssueCallToken,
  canJoinRoom,
  isEndReason,
  resolveEndOutcome,
  resolveLeaveOutcome,
  canAnswerCall,
  canEndForEveryone,
  canMarkTimeout,
  canRejoinAfterLeave,
  resolveDeclineOutcome,
  serverDurationSec,
  RING_TIMEOUT_SEC,
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

describe("otorisasi mengakhiri panggilan", () => {
  const ongoing = { status: "ongoing" as const, requested: "ended" as const, reason: null };

  it("peserta grup biasa tidak bisa mengakhiri panggilan berlangsung untuk semua", () => {
    expect(
      canEndForEveryone({ ...ongoing, isInitiator: false, timeoutElapsed: true }),
    ).toEqual({ allowed: false, code: "use_leave_call" });
  });

  it("host boleh mengakhiri panggilan berlangsung", () => {
    expect(canEndForEveryone({ ...ongoing, isInitiator: true, timeoutElapsed: false }).allowed).toBe(
      true,
    );
  });

  it("penerima tidak boleh memakai end_call untuk menolak", () => {
    expect(
      canEndForEveryone({
        status: "ringing",
        isInitiator: false,
        requested: "ended",
        reason: null,
        timeoutElapsed: false,
      }),
    ).toEqual({ allowed: false, code: "use_decline_call" });
  });

  it("timeout ditolak sebelum 45 detik dan diterima setelahnya", () => {
    const t0 = 1_000_000;
    expect(canMarkTimeout(t0, t0 + 44_000)).toBe(false);
    expect(canMarkTimeout(t0, t0 + RING_TIMEOUT_SEC * 1000)).toBe(true);
    const req = { status: "ringing" as const, requested: "missed" as const, reason: "timeout" as const };
    expect(canEndForEveryone({ ...req, isInitiator: false, timeoutElapsed: false }).code).toBe(
      "timeout_too_early",
    );
    expect(canEndForEveryone({ ...req, isInitiator: false, timeoutElapsed: true }).allowed).toBe(
      true,
    );
  });
});

describe("peserta yang sudah keluar", () => {
  it("tidak bisa join, menjawab, atau mendapat token", () => {
    expect(canRejoinAfterLeave()).toBe(false);
    expect(
      canAnswerCall({
        status: "ringing",
        isInitiator: false,
        participantExists: true,
        participantLeft: true,
      }),
    ).toEqual({ allowed: false, code: "already_left" });
    expect(
      canIssueCallToken({
        status: "ongoing",
        participantExists: true,
        participantLeft: true,
        hasRoom: true,
      }).code,
    ).toBe("already_left");
  });

  it("pemanggil tidak bisa menjawab panggilannya sendiri", () => {
    expect(
      canAnswerCall({
        status: "ringing",
        isInitiator: true,
        participantExists: true,
        participantLeft: false,
      }).code,
    ).toBe("initiator_cannot_answer");
  });
});

describe("penolakan panggilan", () => {
  it("satu penerima grup menolak hanya mengeluarkan dirinya", () => {
    expect(
      resolveDeclineOutcome({
        status: "ringing",
        isInitiator: false,
        totalParticipants: 4,
        remainingRecipients: 2,
      }),
    ).toEqual({ allowed: true, code: "ok", endsCall: false, outcome: null });
  });

  it("penerima aktif terakhir menolak mengakhiri panggilan", () => {
    expect(
      resolveDeclineOutcome({
        status: "ringing",
        isInitiator: false,
        totalParticipants: 4,
        remainingRecipients: 0,
      }),
    ).toEqual({
      allowed: true,
      code: "ok",
      endsCall: true,
      outcome: { status: "declined", reason: "declined" },
    });
  });

  it("panggilan 1:1 langsung declined", () => {
    expect(
      resolveDeclineOutcome({
        status: "ringing",
        isInitiator: false,
        totalParticipants: 2,
        remainingRecipients: 1,
      }).endsCall,
    ).toBe(true);
  });

  it("pemanggil tidak boleh menolak", () => {
    expect(
      resolveDeclineOutcome({
        status: "ringing",
        isInitiator: true,
        totalParticipants: 2,
        remainingRecipients: 1,
      }).code,
    ).toBe("initiator_cannot_decline");
  });

  it("tidak bisa menolak panggilan yang sudah dijawab", () => {
    expect(
      resolveDeclineOutcome({
        status: "ongoing",
        isInitiator: false,
        totalParticipants: 2,
        remainingRecipients: 1,
      }).code,
    ).toBe("call_already_answered");
  });
});

describe("durasi panggilan", () => {
  it("memakai answered_at, bukan angka klien", () => {
    const now = Date.parse("2026-01-01T00:01:00.000Z");
    expect(
      serverDurationSec({
        answeredAt: "2026-01-01T00:00:00.000Z",
        startedAt: null,
        nowMs: now,
        clientFallbackSec: 99_999,
      }),
    ).toBe(60);
  });

  it("fallback klien hanya saat tidak ada timestamp server", () => {
    expect(
      serverDurationSec({ answeredAt: null, startedAt: null, nowMs: 0, clientFallbackSec: 12.4 }),
    ).toBe(12);
  });
});

describe("invarian migrasi panggilan terbaru", () => {
  const dir = "supabase/migrations";
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .filter((sql) => sql.includes("FUNCTION public.decline_call"))
    .at(-1);

  it("migrasi decline_call ada", () => {
    expect(latest).toBeTruthy();
  });

  it("join_call tidak lagi menghidupkan peserta yang keluar", () => {
    expect(latest).toContain("Anda sudah keluar dari panggilan ini");
    expect(latest).not.toContain("left_at = NULL");
  });

  it("end_call menolak peserta non-host dan timeout dini", () => {
    expect(latest).toContain("Peserta harus memakai leave_call untuk keluar");
    expect(latest).toContain("Gunakan decline_call untuk menolak panggilan");
    expect(latest).toContain("Batas waktu dering belum tercapai");
  });

  it("durasi dihitung server dari answered_at/started_at", () => {
    expect(latest).toContain("extract(epoch FROM (_now - COALESCE(_row.answered_at");
  });

  it("ACL decline_call tanpa anon/PUBLIC", () => {
    expect(latest).toContain("REVOKE EXECUTE ON FUNCTION public.decline_call(uuid) FROM PUBLIC, anon");
    expect(latest).toContain(
      "GRANT EXECUTE ON FUNCTION public.decline_call(uuid) TO authenticated, service_role",
    );
  });
});
