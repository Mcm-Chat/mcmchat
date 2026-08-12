import { supabase } from "@/integrations/supabase/client";
import { friendly } from "./db";
import { getOrCreateDirect, sendMessage } from "./chat";
import { signedUrl } from "./storage";
import type {
  OwnerProfile,
  StatusFeedRow,
  StatusItem,
  StatusPrivacy,
  TextMeta,
} from "@/lib/status/model";
import { expiresAtFrom, clampSlideMs } from "@/lib/status/model";

export type StatusPreferences = {
  default_privacy: StatusPrivacy;
  default_lifetime_minutes: number;
  default_slide_ms: number;
  share_view_receipts: boolean;
};

export const DEFAULT_PREFERENCES: StatusPreferences = {
  default_privacy: "contacts",
  default_lifetime_minutes: 1440,
  default_slide_ms: 5000,
  share_view_receipts: true,
};

export async function getStatusPreferences(userId: string): Promise<StatusPreferences> {
  const { data } = await supabase
    .from("status_preferences")
    .select("default_privacy, default_lifetime_minutes, default_slide_ms, share_view_receipts")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? (data as StatusPreferences) : DEFAULT_PREFERENCES;
}

export async function saveStatusPreferences(userId: string, patch: Partial<StatusPreferences>) {
  const current = await getStatusPreferences(userId);
  const { error } = await supabase
    .from("status_preferences")
    .upsert({ user_id: userId, ...current, ...patch }, { onConflict: "user_id" });
  if (error) throw new Error(friendly(error.message, "Pengaturan status gagal disimpan"));
}

export type FeedPayload = {
  rows: StatusFeedRow[];
  items: StatusItem[];
  profiles: Record<string, OwnerProfile>;
  seen: Set<string>;
};

/** Feed status: RPC ringkasan + slide + profil pemilik + slide yang sudah saya lihat. */
export async function loadFeed(userId: string): Promise<FeedPayload> {
  const { data: rowsRaw, error } = await supabase.rpc("status_feed");
  if (error) throw new Error(friendly(error.message, "Status gagal dimuat"));
  const rows = (rowsRaw ?? []) as unknown as StatusFeedRow[];
  if (rows.length === 0) return { rows, items: [], profiles: {}, seen: new Set() };

  const statusIds = rows.map((r) => r.status_id);
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))];
  const [{ data: itemRows }, { data: profileRows }] = await Promise.all([
    supabase.from("status_items").select("*").in("status_id", statusIds).order("sort_order"),
    supabase.from("profiles").select("id, display_name, avatar_url, avatar_color").in("id", ownerIds),
  ]);
  const items = ((itemRows ?? []) as unknown as StatusItem[]).map((i) => ({
    ...i,
    text_meta: (i.text_meta ?? {}) as TextMeta,
  }));
  const profiles: Record<string, OwnerProfile> = {};
  for (const p of profileRows ?? []) profiles[p.id] = p as OwnerProfile;

  const seen = new Set<string>();
  const itemIds = items.filter((i) => i.owner_id !== userId).map((i) => i.id);
  if (itemIds.length > 0) {
    const { data: views } = await supabase
      .from("status_views")
      .select("item_id")
      .eq("viewer_id", userId)
      .in("item_id", itemIds);
    for (const v of views ?? []) seen.add(v.item_id);
  }
  return { rows, items, profiles, seen };
}

export type NewSlide = {
  kind: "image" | "text";
  blob?: Blob;
  thumb?: Blob;
  width?: number;
  height?: number;
  textMeta?: TextMeta;
  caption?: string;
  durationMs: number;
};

export type PostStatusInput = {
  userId: string;
  caption: string;
  privacy: StatusPrivacy;
  audience: string[];
  lifetimeMinutes: number;
  slides: NewSlide[];
};

async function uploadStatusFile(userId: string, blob: Blob, suffix: string) {
  const path = `${userId}/${crypto.randomUUID()}-${suffix}.jpg`;
  const { error } = await supabase.storage.from("status-media").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error("Media status gagal diunggah. Coba lagi.");
  return path;
}

/** Simpan satu status beserta seluruh slide-nya. */
export async function postStatus(input: PostStatusInput): Promise<string> {
  if (input.slides.length === 0) throw new Error("Tambahkan minimal satu slide status.");
  const { data: status, error } = await supabase
    .from("statuses")
    .insert({
      owner_id: input.userId,
      caption: input.caption,
      privacy: input.privacy,
      expires_at: expiresAtFrom(input.lifetimeMinutes),
    })
    .select("id")
    .single();
  if (error || !status) throw new Error(friendly(error?.message ?? "", "Status gagal diunggah"));

  if (input.privacy !== "contacts" && input.audience.length > 0) {
    await supabase
      .from("status_audience")
      .insert(input.audience.map((user_id) => ({ status_id: status.id, user_id })));
  }

  const rows = [];
  for (let i = 0; i < input.slides.length; i++) {
    const s = input.slides[i]!;
    let media_path: string | null = null;
    let thumb_path: string | null = null;
    if (s.blob) media_path = await uploadStatusFile(input.userId, s.blob, "full");
    if (s.thumb) thumb_path = await uploadStatusFile(input.userId, s.thumb, "thumb");
    rows.push({
      status_id: status.id,
      owner_id: input.userId,
      kind: s.kind,
      media_path,
      thumb_path,
      width: s.width ?? 0,
      height: s.height ?? 0,
      duration_ms: clampSlideMs(s.durationMs),
      sort_order: i,
      caption: s.caption ?? "",
      text_meta: (s.textMeta ?? {}) as never,
    });
  }
  const { error: itemErr } = await supabase.from("status_items").insert(rows);
  if (itemErr) {
    await supabase.from("statuses").delete().eq("id", status.id);
    throw new Error(friendly(itemErr.message, "Slide status gagal disimpan"));
  }
  return status.id;
}

/** Catat slide sebagai dilihat. Dilewati bila pengguna mematikan tanda dilihat. */
export async function markStatusViewed(item: StatusItem, userId: string, share: boolean) {
  if (item.owner_id === userId || !share) return;
  await supabase
    .from("status_views")
    .upsert({ item_id: item.id, viewer_id: userId, status_id: item.status_id }, { onConflict: "item_id,viewer_id" });
}

export type ViewerRow = {
  viewer_id: string;
  viewed_at: string;
  item_id: string;
  profile: OwnerProfile | null;
  emoji: string | null;
};

export async function listViewers(statusId: string): Promise<ViewerRow[]> {
  const [{ data: views }, { data: reactions }] = await Promise.all([
    supabase.from("status_views").select("item_id, viewer_id, viewed_at").eq("status_id", statusId).order("viewed_at", { ascending: false }),
    supabase.from("status_reactions").select("item_id, user_id, emoji").eq("status_id", statusId),
  ]);
  const ids = [...new Set((views ?? []).map((v) => v.viewer_id))];
  const profiles: Record<string, OwnerProfile> = {};
  if (ids.length > 0) {
    const { data } = await supabase.from("profiles").select("id, display_name, avatar_url, avatar_color").in("id", ids);
    for (const p of data ?? []) profiles[p.id] = p as OwnerProfile;
  }
  return (views ?? []).map((v) => ({
    viewer_id: v.viewer_id,
    viewed_at: v.viewed_at,
    item_id: v.item_id,
    profile: profiles[v.viewer_id] ?? null,
    emoji: (reactions ?? []).find((r) => r.user_id === v.viewer_id && r.item_id === v.item_id)?.emoji ?? null,
  }));
}

/** Reaksi tersimpan di database dan dikirim juga sebagai pesan ke pemilik. */
export async function reactToStatus(item: StatusItem, userId: string, emoji: string) {
  await supabase
    .from("status_reactions")
    .upsert({ item_id: item.id, user_id: userId, status_id: item.status_id, emoji }, { onConflict: "item_id,user_id" });
  await replyToStatus(item, userId, emoji);
}

/** Balasan status masuk ke chat langsung dengan kutipan slide-nya. */
export async function replyToStatus(item: StatusItem, userId: string, body: string) {
  const conversationId = await getOrCreateDirect(userId, item.owner_id);
  await sendMessage({
    conversationId,
    senderId: userId,
    kind: "text",
    body,
    clientId: crypto.randomUUID(),
    payload: {
      type: "status_reply",
      statusId: item.status_id,
      itemId: item.id,
      ownerId: item.owner_id,
      thumbPath: item.thumb_path ?? item.media_path,
      preview: item.caption || item.text_meta?.text || "Status",
    },
  });
  return conversationId;
}

export async function deleteStatusItem(item: StatusItem) {
  const { error } = await supabase.from("status_items").delete().eq("id", item.id);
  if (error) throw new Error(friendly(error.message, "Slide gagal dihapus"));
  const paths = [item.media_path, item.thumb_path].filter((p): p is string => !!p);
  if (paths.length > 0) await supabase.storage.from("status-media").remove(paths);
  // Status tanpa slide tersisa ikut ditandai terhapus agar tidak jadi kartu kosong.
  const { count } = await supabase
    .from("status_items")
    .select("id", { count: "exact", head: true })
    .eq("status_id", item.status_id);
  if ((count ?? 0) === 0) await supabase.from("statuses").update({ deleted_at: new Date().toISOString() }).eq("id", item.status_id);
}

export async function deleteStatus(statusId: string, items: StatusItem[]) {
  const { error } = await supabase.from("statuses").update({ deleted_at: new Date().toISOString() }).eq("id", statusId);
  if (error) throw new Error(friendly(error.message, "Status gagal dihapus"));
  const paths = items.flatMap((i) => [i.media_path, i.thumb_path]).filter((p): p is string => !!p);
  if (paths.length > 0) await supabase.storage.from("status-media").remove(paths);
}

export async function setStatusMuted(userId: string, ownerId: string, muted: boolean) {
  if (muted) await supabase.from("status_mutes").upsert({ user_id: userId, muted_user_id: ownerId });
  else await supabase.from("status_mutes").delete().eq("user_id", userId).eq("muted_user_id", ownerId);
}

export const statusMediaUrl = (path: string | null) => (path ? signedUrl("status-media", path) : Promise.resolve(null));
