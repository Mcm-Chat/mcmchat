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

    // Otorisasi eksplisit: baris peserta harus ada untuk pengguna ini.
    // RLS tetap berlaku, tetapi izin masuk room TIDAK boleh bergantung pada
    // efek samping kebijakan saja.
    const { data: participant } = await context.supabase
      .from("call_participants")
      .select("user_id, left_at")
      .eq("call_id", data.callId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!participant) {
      return { configured: true as const, allowed: false as const, reason: "Anda bukan peserta panggilan ini" };
    }

    const { data: call } = await context.supabase
      .from("calls")
      .select("id, kind, status, room_name")
      .eq("id", data.callId)
      .maybeSingle();
    if (!call) return { configured: true as const, allowed: false as const, reason: "Panggilan tidak ditemukan" };
    if (call.status === "ended" || call.status === "missed" || call.status === "declined" || call.status === "failed") {
      return { configured: true as const, allowed: false as const, reason: "Panggilan sudah berakhir" };
    }
    // Room dibuat server saat panggilan dibuat; tanpa itu token tidak diterbitkan.
    if (!call.room_name) {
      return { configured: true as const, allowed: false as const, reason: "Panggilan tidak valid" };
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
    return { configured: true as const, allowed: true as const, url: cfg.url, token, room, expiresAt };
  });
