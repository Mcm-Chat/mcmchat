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
import { reportPushDenied, type PushDeniedCode } from "./denied-notice";

export type GuardedRoute = {
  route: string;
  blocked: boolean;
  reason?: string;
  code?: PushDeniedCode;
  title?: string;
  /** Id percakapan asal (bila rute push menunjuk percakapan). */
  conversationId?: string;
};

const CONV_RE = /^\/chat\/([0-9a-f-]{36})(?:[/?#]|$)/i;

const REASON_TEXT: Record<string, { code: PushDeniedCode; title: string; detail: string }> = {
  not_member: {
    code: "not_member",
    title: "Bukan peserta percakapan",
    detail:
      "Notifikasi ini dari percakapan yang sudah tidak Anda ikuti, jadi isinya tidak bisa dibuka. Anda diarahkan ke daftar chat.",
  },
  blocked: {
    code: "blocked",
    title: "Percakapan diblokir",
    detail:
      "Percakapan ini sedang diblokir, jadi pesannya tidak dibuka. Buka blokir kontaknya dulu bila ingin melanjutkan.",
  },
  removed: {
    code: "removed",
    title: "Anda dikeluarkan dari percakapan",
    detail:
      "Admin percakapan mengeluarkan Anda, sehingga pesan lama maupun baru tidak lagi bisa dibuka dari notifikasi ini.",
  },
  missing: {
    code: "missing",
    title: "Percakapan sudah tidak ada",
    detail:
      "Percakapan yang dituju notifikasi ini sudah dihapus. Notifikasinya bisa diabaikan.",
  },
};

const UNKNOWN = {
  code: "unknown" as PushDeniedCode,
  title: "Akses percakapan ditolak",
  detail:
    "Server menolak membuka percakapan dari notifikasi ini. Coba buka lewat daftar chat, atau minta kontak Anda mengundang ulang.",
};

/**
 * Kembalikan rute yang aman dinavigasi. Rute non-percakapan diteruskan apa
 * adanya; percakapan tanpa izin baca jatuh ke daftar chat disertai alasan.
 */
export async function guardPushRoute(route: string): Promise<GuardedRoute> {
  if (!route.startsWith("/") || route.startsWith("//")) {
    return {
      route: "/chat",
      blocked: true,
      code: "invalid_route",
      title: "Tautan notifikasi tidak sah",
      reason: "Notifikasi ini menunjuk ke alamat di luar aplikasi, jadi tidak dibuka.",
    };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return {
      route: "/login",
      blocked: true,
      code: "no_session",
      title: "Sesi Anda sudah berakhir",
      reason: "Masuk dulu dengan PIN Anda untuk membuka pesan dari notifikasi ini.",
    };
  }

  const conversationId = CONV_RE.exec(route)?.[1];
  if (!conversationId) return { route, blocked: false };

  try {
    const cap = await fetchConversationCapability(conversationId);
    if (cap.readable) return { route, blocked: false };
    const info = REASON_TEXT[cap.reason] ?? UNKNOWN;
    return {
      route: "/chat",
      blocked: true,
      code: info.code,
      title: info.title,
      reason: info.detail,
      conversationId,
    };
  } catch {
    // Jaringan gagal: jangan kunci pengguna keluar dari percakapan miliknya —
    // rute tetap dibuka dan layar chat punya fallback aksesnya sendiri.
    return { route, blocked: false };
  }
}

/**
 * Tampilkan penjelasan penolakan (modal + toast ringkas) bila rute diblokir.
 */
export function announceGuardResult(guarded: GuardedRoute): void {
  if (!guarded.blocked || !guarded.reason) return;
  reportPushDenied({
    code: guarded.code ?? "unknown",
    title: guarded.title ?? "Akses ditolak",
    detail: guarded.reason,
    fallbackRoute: guarded.route,
    conversationId: guarded.conversationId,
  });
}
