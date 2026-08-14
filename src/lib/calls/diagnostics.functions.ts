import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const probeInput = z.object({ callId: z.string().uuid() });

/**
 * Tes penerbitan token untuk panggilan yang sah. Hanya melaporkan apakah token
 * berhasil dibuat dan kapan kedaluwarsa — token, URL, dan secret tidak pernah
 * dikembalikan ke klien diagnostik.
 */
export const probeCallToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => probeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { readLiveKitConfig, mintAccessToken } = await import("./livekit.server");
    const cfg = readLiveKitConfig();
    if (!cfg) return { ok: false as const, code: "provider_unconfigured" };

    const { data: participant } = await context.supabase
      .from("call_participants")
      .select("user_id, left_at")
      .eq("call_id", data.callId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!participant) return { ok: false as const, code: "not_participant" };
    if (participant.left_at) return { ok: false as const, code: "already_left" };

    const { data: call } = await context.supabase
      .from("calls")
      .select("id, kind, status, room_name")
      .eq("id", data.callId)
      .maybeSingle();
    if (!call?.room_name) return { ok: false as const, code: "call_invalid" };
    if (!["ringing", "ongoing"].includes(call.status))
      return { ok: false as const, code: "call_ended" };

    const { expiresAt } = await mintAccessToken(cfg, {
      room: call.room_name,
      identity: context.userId,
      name: "Diagnostik",
      canPublishVideo: call.kind === "video",
      ttlSec: 60,
    });
    return { ok: true as const, expiresInSec: Math.round((expiresAt - Date.now()) / 1000) };
  });
