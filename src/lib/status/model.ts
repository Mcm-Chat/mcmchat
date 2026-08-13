/**
 * Logika murni modul Status: masa aktif, durasi slide, pengelompokan feed, dan
 * keputusan navigasi viewer. Sengaja bebas DOM/Supabase agar bisa diuji.
 */

export type StatusPrivacy = "contacts" | "contacts_except" | "only_share_with";
export type StatusItemKind = "image" | "text" | "video";

export type TextMeta = {
  text?: string;
  background?: string;
  color?: string;
  font?: string;
  align?: "left" | "center" | "right";
};

export type StatusItem = {
  id: string;
  status_id: string;
  owner_id: string;
  kind: StatusItemKind;
  media_path: string | null;
  thumb_path: string | null;
  duration_ms: number;
  sort_order: number;
  caption: string;
  text_meta: TextMeta;
  created_at: string;
};

export type StatusFeedRow = {
  status_id: string;
  owner_id: string;
  caption: string;
  privacy: StatusPrivacy;
  created_at: string;
  expires_at: string;
  last_item_at: string;
  item_count: number;
  unseen_count: number;
  muted: boolean;
};

export type OwnerProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  avatar_version?: number;
};

export type StatusGroup = {
  ownerId: string;
  profile: OwnerProfile | null;
  items: StatusItem[];
  statusIds: string[];
  unseen: number;
  muted: boolean;
  lastAt: string;
  expiresAt: string;
  mine: boolean;
};

export const LIFETIME_OPTIONS = [
  { minutes: 60, label: "1 jam" },
  { minutes: 360, label: "6 jam" },
  { minutes: 720, label: "12 jam" },
  { minutes: 1440, label: "24 jam" },
  { minutes: 4320, label: "3 hari" },
  { minutes: 10080, label: "7 hari" },
] as const;

export const SLIDE_OPTIONS = [3000, 5000, 7000, 10000, 15000] as const;

export const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👏", "👍"] as const;

export const TEXT_BACKGROUNDS = [
  "linear-gradient(160deg,#0f172a,#1e3a8a)",
  "linear-gradient(160deg,#064e3b,#10b981)",
  "linear-gradient(160deg,#7c2d12,#f59e0b)",
  "linear-gradient(160deg,#4c1d95,#a855f7)",
  "linear-gradient(160deg,#111827,#374151)",
  "linear-gradient(160deg,#831843,#fb7185)",
] as const;

export const TEXT_FONTS = [
  { id: "sans", label: "Modern", css: "600 44px ui-sans-serif, system-ui, sans-serif" },
  { id: "serif", label: "Klasik", css: "600 44px ui-serif, Georgia, serif" },
  { id: "mono", label: "Mesin Tik", css: "600 40px ui-monospace, SFMono-Regular, monospace" },
] as const;

export const clampSlideMs = (ms: number) => Math.min(30000, Math.max(1000, Math.round(ms)));

export const clampLifetimeMinutes = (m: number) => Math.min(10080, Math.max(15, Math.round(m)));

export function expiresAtFrom(minutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() + clampLifetimeMinutes(minutes) * 60_000).toISOString();
}

/** "Berakhir dalam 3 jam" → dipakai di feed dan viewer. */
export function sisaWaktu(expiresAt: string, now: Date = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return "Kedaluwarsa";
  const menit = Math.floor(ms / 60_000);
  if (menit < 60) return `${Math.max(1, menit)} menit lagi`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lagi`;
  return `${Math.floor(jam / 24)} hari lagi`;
}

export function waktuStatus(iso: string, now: Date = new Date()): string {
  const menit = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (menit < 1) return "Baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

/**
 * Gabungkan baris feed + slide menjadi satu kartu per pemilik.
 * Urutan: milik saya, lalu yang belum dilihat (terbaru dulu), lalu yang sudah
 * dilihat, dan terakhir kontak yang dibisukan.
 */
export function groupFeed(
  rows: StatusFeedRow[],
  items: StatusItem[],
  profiles: Record<string, OwnerProfile>,
  myId: string,
  seen: ReadonlySet<string> = new Set(),
): StatusGroup[] {
  const byStatus = new Map<string, StatusItem[]>();
  for (const it of items) {
    const list = byStatus.get(it.status_id) ?? [];
    list.push(it);
    byStatus.set(it.status_id, list);
  }
  const byOwner = new Map<string, StatusGroup>();
  for (const row of rows) {
    const its = (byStatus.get(row.status_id) ?? []).slice().sort((a, b) =>
      a.sort_order === b.sort_order ? a.created_at.localeCompare(b.created_at) : a.sort_order - b.sort_order,
    );
    const g = byOwner.get(row.owner_id) ?? {
      ownerId: row.owner_id,
      profile: profiles[row.owner_id] ?? null,
      items: [],
      statusIds: [],
      unseen: 0,
      muted: row.muted,
      lastAt: row.last_item_at,
      expiresAt: row.expires_at,
      mine: row.owner_id === myId,
    };
    g.items = g.items.concat(its);
    g.statusIds = g.statusIds.concat(row.status_id);
    g.unseen += row.owner_id === myId ? 0 : its.filter((i) => !seen.has(i.id)).length || row.unseen_count;
    g.muted = g.muted || row.muted;
    if (row.last_item_at > g.lastAt) g.lastAt = row.last_item_at;
    if (row.expires_at > g.expiresAt) g.expiresAt = row.expires_at;
    byOwner.set(row.owner_id, g);
  }
  const groups = [...byOwner.values()].filter((g) => g.items.length > 0);
  for (const g of groups)
    g.items.sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
  const rank = (g: StatusGroup) => (g.mine ? 0 : g.muted ? 3 : g.unseen > 0 ? 1 : 2);
  return groups.sort((a, b) => (rank(a) === rank(b) ? b.lastAt.localeCompare(a.lastAt) : rank(a) - rank(b)));
}

/** Slide pertama yang belum dilihat; jatuh ke 0 bila semua sudah dilihat. */
export function firstUnseenIndex(items: StatusItem[], seen: ReadonlySet<string>): number {
  const i = items.findIndex((it) => !seen.has(it.id));
  return i < 0 ? 0 : i;
}

export type Advance = { groupIndex: number; itemIndex: number; done: boolean };

/** Navigasi maju/mundur lintas grup persis seperti viewer status pada umumnya. */
export function advance(
  groups: { items: unknown[] }[],
  groupIndex: number,
  itemIndex: number,
  dir: 1 | -1,
): Advance {
  const g = groups[groupIndex];
  if (!g) return { groupIndex, itemIndex, done: true };
  const next = itemIndex + dir;
  if (next >= 0 && next < g.items.length) return { groupIndex, itemIndex: next, done: false };
  const ng = groupIndex + dir;
  if (ng < 0) return { groupIndex, itemIndex: 0, done: false };
  if (ng >= groups.length) return { groupIndex, itemIndex, done: true };
  const target = groups[ng]!;
  return { groupIndex: ng, itemIndex: dir === 1 ? 0 : Math.max(0, target.items.length - 1), done: false };
}

export const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "MC";
