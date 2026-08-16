import type { NotifCategory } from "@/lib/push/payload";

/**
 * Pemetaan `notifications.kind` → kategori preferensi pengguna
 * (`user_settings.notifications`). Dipakai agar daftar notifikasi di dalam
 * aplikasi mengikuti toggle yang sama dengan push.
 */
export function categoryOfKind(kind: string | null | undefined): NotifCategory | null {
  const k = (kind ?? "").toLowerCase();
  if (k.includes("contact") || k.includes("kontak")) return "chat";
  if (k.includes("call") || k.includes("panggil")) return "calls";
  if (k.includes("group") || k.includes("grup")) return "group";
  if (k.includes("ledger") || k.includes("hutang") || k.includes("payment") || k.includes("bayar"))
    return "ledger";
  if (k.includes("task") || k.includes("prep") || k.includes("tugas")) return "tasks";
  if (k.includes("sale") || k.includes("order") || k.includes("jual") || k.includes("pesanan"))
    return "sales";
  if (k.includes("message") || k.includes("chat") || k.includes("pesan")) return "chat";
  return null;
}
