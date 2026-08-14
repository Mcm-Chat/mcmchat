import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** TTL token diagnostik — sengaja sangat pendek. */
export const DIAGNOSTIC_TTL_SEC = 60;

/**
 * Token diagnostik: room acak sekali pakai, hanya boleh menyambung
 * (tanpa publish/subscribe/data), berlaku <= 60 detik. Tidak menyentuh baris
 * `calls` mana pun, sehingga riwayat panggilan tidak pernah berubah.
 * URL dan token hanya dipakai sekali oleh aksi tes lalu dibuang.
 */
export const issueDiagnosticToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readLiveKitConfigResult, mintAccessToken } = await import("./livekit.server");
    const cfg = readLiveKitConfigResult();
    if (!cfg.ok) return { ok: false as const, code: cfg.code };

    const room = `mcm-diag-${crypto.randomUUID().replace(/-/g, "")}`;
    const { token, expiresAt } = await mintAccessToken(cfg.config, {
      room,
      identity: `diag-${context.userId}`,
      name: "Diagnostik",
      canPublishVideo: false,
      observerOnly: true,
      ttlSec: DIAGNOSTIC_TTL_SEC,
    });
    return {
      ok: true as const,
      url: cfg.config.url,
      token,
      room,
      expiresInSec: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
    };
  });
