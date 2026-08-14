import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { canIssueCallToken, type CallStatusValue } from "./policy";

/** Status penyedia panggilan — dipakai UI untuk menampilkan "Belum terhubung". */
export const getCallConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { readLiveKitConfigResult } = await import("./livekit.server");
  const r = readLiveKitConfigResult();
  return {
    provider: "livekit" as const,
    configured: r.ok,
    code: r.ok ? "ok" : r.code,
  };
});

const tokenInput = z.object({ callId: z.string().uuid() });

const DENY_MESSAGE: Record<string, string> = {
  not_participant: "Anda bukan peserta panggilan ini",
  already_left: "Anda sudah keluar dari panggilan ini",
  call_invalid: "Panggilan tidak valid",
  call_not_answered: "Panggilan belum dijawab",
  call_ended: "Panggilan sudah berakhir",
};

/**
 * Terbitkan token LiveKit berumur pendek. Hanya peserta panggilan yang
 * terdaftar DAN panggilan yang sudah dijawab (`ongoing`) yang mendapat token;
 * secret tidak pernah meninggalkan server.
 */
export const issueCallToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => tokenInput.parse(input))
  .handler(async ({ data, context }) => {
    const { readLiveKitConfig, mintAccessToken } = await import("./livekit.server");
    const cfg = readLiveKitConfig();
    if (!cfg) return { configured: false as const, reason: "Penyedia panggilan belum terhubung" };

    // Otorisasi eksplisit: baris peserta harus ada untuk pengguna ini.
    const { data: participant } = await context.supabase
      .from("call_participants")
      .select("user_id, left_at")
      .eq("call_id", data.callId)
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: call } = await context.supabase
      .from("calls")
      .select("id, kind, status, room_name")
      .eq("id", data.callId)
      .maybeSingle();

    const decision = canIssueCallToken({
      status: (call?.status ?? "ended") as CallStatusValue,
      participantExists: Boolean(participant),
      participantLeft: Boolean(participant?.left_at),
      hasRoom: Boolean(call?.room_name),
    });
    if (!decision.allowed || !call?.room_name) {
      return {
        configured: true as const,
        allowed: false as const,
        code: decision.code,
        reason: DENY_MESSAGE[decision.code] ?? "Panggilan tidak tersedia",
      };
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();

    const room = call.room_name;
    const { token, expiresAt } = await mintAccessToken(cfg, {
      room,
      identity: context.userId,
      name: profile?.display_name ?? "Pengguna MCM",
      canPublishVideo: call.kind === "video",
      ttlSec: 900,
    });
    return {
      configured: true as const,
      allowed: true as const,
      url: cfg.url,
      token,
      room,
      expiresAt,
    };
  });
