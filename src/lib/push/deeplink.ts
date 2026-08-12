import type { PushData } from "./payload";

/**
 * Ubah payload notifikasi menjadi rute internal aplikasi.
 * Payload yang tidak dikenal / tanpa id valid selalu jatuh ke rute aman
 * sehingga notifikasi lama untuk record yang sudah dihapus tidak membuat
 * aplikasi blank.
 */
export function routeFromPush(data: Partial<PushData> | null | undefined): string {
  if (!data) return "/chat";
  if (data.route && data.route.startsWith("/") && !data.route.startsWith("//")) return data.route;
  switch (data.kind) {
    case "message":
    case "call":
      return data.conversationId
        ? `/chat/${data.conversationId}${data.messageId ? `?m=${data.messageId}` : ""}`
        : "/chat";
    case "task_assigned":
    case "task_completed":
      return data.jobId ? `/tasks/${data.jobId}` : "/tasks";
    case "sale":
    case "order":
      return data.orderId ? `/catalog/${data.orderId}` : "/finance";
    case "ledger":
      return data.ledgerId ? `/ledger/${data.ledgerId}` : "/finance";
    default:
      return "/chat";
  }
}

/** Kunci grup notifikasi agar satu percakapan tidak membanjiri shade. */
export function groupKeyFromPush(data: Partial<PushData>): string {
  return (
    data.group ??
    data.conversationId ??
    data.jobId ??
    data.orderId ??
    data.ledgerId ??
    "mcm"
  );
}
