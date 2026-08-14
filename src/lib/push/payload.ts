/**
 * Kontrak payload push MCM (dipakai bersama oleh pengirim di server dan
 * receiver native Android). Semua field bertipe string karena FCM `data`
 * message hanya menerima string.
 */

/** Channel notifikasi Android (id teknis → nama yang tampil ke pengguna). */
export const CHANNELS = {
  messages: { id: "mcm_messages", name: "Pesan", importance: 4 },
  calls: { id: "mcm_calls", name: "Panggilan", importance: 5 },
  tasks: { id: "mcm_tasks", name: "Tugas Penyiapan", importance: 4 },
  sales: { id: "mcm_sales", name: "Penjualan & Pesanan", importance: 3 },
  ledger: { id: "mcm_ledger", name: "Hutang & Pembayaran", importance: 3 },
  general: { id: "mcm_general", name: "Umum", importance: 2 },
} as const;

export type ChannelKey = keyof typeof CHANNELS;

/** Kategori preferensi notifikasi per pengguna (kolom `user_settings.notifications`). */
export type NotifCategory = "chat" | "group" | "calls" | "tasks" | "sales" | "ledger";

export type PushKind =
  "message" | "call" | "task_assigned" | "task_completed" | "sale" | "order" | "ledger";

export type PushData = {
  kind: PushKind;
  /** Dipakai Android untuk memilih channel. */
  channel: string;
  /** Kunci pengelompokan notifikasi (satu grup per percakapan/record). */
  group: string;
  /** Deep link internal, mis. `/chat/<id>?m=<messageId>`. */
  route: string;
  conversationId?: string;
  messageId?: string;
  callId?: string;
  jobId?: string;
  orderId?: string;
  ledgerId?: string;
  /** "1" bila balasan inline boleh ditampilkan pada notifikasi ini. */
  canReply?: string;
  /** Token aksi sekali-pakai per notifikasi (device-scoped, TTL pendek). */
  actionToken?: string;
  /** Id unik notifikasi untuk idempotensi aksi latar. */
  actionId?: string;
  title: string;
  body: string;
};

export const GENERIC_BODY = "Pesan baru";

/**
 * Ringkas isi pesan untuk notifikasi. Bila pratinjau layar kunci dimatikan,
 * isi asli TIDAK PERNAH dikirim ke perangkat — hanya teks generik.
 */
export function previewBody(kind: string, body: string, allowPreview: boolean): string {
  if (!allowPreview) return GENERIC_BODY;
  switch (kind) {
    case "image":
      return "📷 Foto";
    case "document":
      return "📎 Dokumen";
    case "voice":
      return "🎤 Pesan suara";
    case "sticker":
      return "🙂 Stiker";
    case "location":
      return "📍 Lokasi";
    case "sales_card":
      return "🧾 Nota penjualan";
    case "product_card":
      return "🛍️ Kartu produk";
    case "ledger":
      return "💳 Catatan hutang";
    case "order":
      return "🛒 Pesanan";
    default: {
      const clean = body.replace(/\s+/g, " ").trim();
      if (!clean) return GENERIC_BODY;
      return clean.length > 140 ? `${clean.slice(0, 139)}…` : clean;
    }
  }
}

/** Judul aman: nama grup/pengirim tetap boleh, isi pesan tidak. */
export function notificationTitle(chatTitle: string, allowPreview: boolean): string {
  return allowPreview ? chatTitle : "MCM";
}
