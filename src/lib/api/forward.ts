/**
 * Teruskan pesan ke percakapan lain.
 *
 * Lampiran tidak pernah dibagikan lewat path yang sama: berkasnya diunduh lalu
 * diunggah ulang ke folder percakapan tujuan sehingga izin storage tetap
 * mengikuti keanggotaan percakapan tujuan.
 */
import { supabase } from "@/integrations/supabase/client";
import { sendMessage, type MessageRow } from "@/lib/api/chat";
import { friendly } from "@/lib/api/db";

export async function forwardMessage(
  message: MessageRow,
  targetConversationId: string,
  senderId: string,
): Promise<void> {
  let file: { blob: Blob; name: string } | null = null;
  if (message.attachment_path) {
    const { data, error } = await supabase.storage
      .from("chat-media")
      .download(message.attachment_path);
    if (error || !data) throw new Error("Lampiran tidak bisa diteruskan");
    file = { blob: data, name: message.attachment_name ?? "lampiran" };
  }
  await sendMessage({
    conversationId: targetConversationId,
    senderId,
    kind: message.kind,
    body: message.body ?? "",
    file,
    payload: (message.payload ?? null) as Record<string, unknown> | null,
    durationSec: message.duration_sec,
    location:
      message.location_lat != null && message.location_lng != null
        ? {
            lat: message.location_lat,
            lng: message.location_lng,
            accuracy: message.location_accuracy ?? 0,
            label: message.location_label ?? "",
            mapsUrl: message.location_maps_url ?? "",
          }
        : null,
  });
}

/** Teruskan beberapa pesan ke beberapa percakapan sekaligus. */
export async function forwardMessages(
  messages: MessageRow[],
  targetIds: string[],
  senderId: string,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const target of targetIds) {
    for (const m of messages) {
      try {
        await forwardMessage(m, target, senderId);
        ok += 1;
      } catch (err) {
        failed += 1;
        if (failed === 1 && err instanceof Error) friendly(err.message, "Gagal meneruskan");
      }
    }
  }
  return { ok, failed };
}
