/**
 * Validasi izin sebelum menavigasi ke rute dari payload notifikasi.
 *
 * Payload push bisa usang (dikeluarkan dari grup, kontak diblokir, akun lain
 * sedang login di perangkat yang sama, percakapan dihapus). Menavigasi buta ke
 * `/chat/:id` pada kondisi itu menghasilkan layar error. Server tetap menjadi
 * sumber kebenaran: kapabilitas dibaca lewat `my_conversation_capability`.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchConversationCapability } from "@/lib/api/conversations";

export type GuardedRoute = { route: string; blocked: boolean; reason?: string };

const CONV_RE = /^\/chat\/([0-9a-f-]{36})(?:[/?#]|$)/i;

const REASON_TEXT: Record<string, string> = {
  not_member: "Anda bukan peserta percakapan itu lagi.",
  blocked: "Percakapan itu diblokir.",
  removed: "Anda sudah dikeluarkan dari percakapan itu.",
  missing: "Percakapan itu sudah tidak ada.",
};

/**
 * Kembalikan rute yang aman dinavigasi. Rute non-percakapan diteruskan apa
 * adanya; percakapan tanpa izin baca jatuh ke daftar chat disertai alasan.
 */
export async function guardPushRoute(route: string): Promise<GuardedRoute> {
  if (!route.startsWith("/") || route.startsWith("//")) return { route: "/chat", blocked: true };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { route: "/login", blocked: true, reason: "Masuk dulu untuk membuka pesan." };

  const conversationId = CONV_RE.exec(route)?.[1];
  if (!conversationId) return { route, blocked: false };

  try {
    const cap = await fetchConversationCapability(conversationId);
    if (cap.readable) return { route, blocked: false };
    return {
      route: "/chat",
      blocked: true,
      reason: REASON_TEXT[cap.reason] ?? "Anda tidak punya akses ke percakapan itu.",
    };
  } catch {
    // Jaringan gagal: jangan kunci pengguna keluar dari percakapan miliknya —
    // rute tetap dibuka dan layar chat punya fallback aksesnya sendiri.
    return { route, blocked: false };
  }
}
