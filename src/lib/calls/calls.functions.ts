import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Status penyedia panggilan — dipakai UI untuk menampilkan "Belum terhubung". */
export const getCallConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { liveKitConfigured } = await import("./livekit.server");
  return { provider: "livekit" as const, configured: liveKitConfigured() };
});

const tokenInput = z.object({ callId: z.string().uuid() });

/**
 * Terbitkan token LiveKit berumur pendek. Hanya peserta panggilan yang
 * terdaftar di database yang bisa mendapatkannya; secret tidak pernah
 * meninggalkan server.
 */
export const issueCallToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => tokenInput.parse(input))
  .handler(async ({ data, context }) => {
    const { readLiveKitConfig, mintAccessToken } = await import("./livekit.server");
    const cfg = readLiveKitConfig();
    if (!cfg) return { configured: false as const, reason: "Penyedia panggilan belum terhubung" };

    // RLS memastikan baris hanya terbaca oleh peserta panggilan.
    const { data: call } = await context.supabase
      .from("calls")
      .select("id, kind, status, room_name")
      .eq("id", data.callId)
      .maybeSingle();
    if (!call) return { configured: true as const, allowed: false as const, reason: "Panggilan tidak ditemukan" };
    if (call.status === "ended" || call.status === "missed" || call.status === "declined") {
      return { configured: true as const, allowed: false as const, reason: "Panggilan sudah berakhir" };
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();

    const room = call.room_name ?? `mcm-${call.id}`;
    const { token, expiresAt } = await mintAccessToken(cfg, {
      room,
      identity: context.userId,
      name: profile?.display_name ?? "Pengguna MCM",
      canPublishVideo: call.kind === "video",
      ttlSec: 900,
    });
    return { configured: true as const, allowed: true as const, url: cfg.url, token, room, expiresAt };
  });
