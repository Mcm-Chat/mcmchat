import { Link } from "@tanstack/react-router";
import {
  Archive,
  BellOff,
  Camera,
  Check,
  CheckCheck,
  ClipboardList,
  CornerUpLeft,
  Copy,
  FileText,
  Forward,
  Image as ImageIcon,
  MapPin,
  Mic,
  MoreVertical,
  Package,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Send,
  ShoppingCart,
  Smile,
  Sticker,
  Square,
  Trash2,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, TouchEvent as ReactTouchEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { createChatOrder } from "@/lib/api/chat-orders";
import { useBackDismiss } from "@/lib/mobile/back-guard";
import { ChatOrderCard } from "@/components/mcm/chat-order-card";
import { cn } from "@/lib/utils";
import { LinkifiedText } from "@/components/mcm/linkified-text";
import { jam, rupiah } from "@/lib/mcm/format";
import { useSignedUrl } from "@/lib/api/use-signed-url";
import type { ConversationView, MessageRow } from "@/lib/api/chat";
import { useStatusMedia } from "@/lib/status/hooks";
import { previewOf } from "@/lib/api/chat";
import type { MessageStatus } from "@/lib/api/receipts";
import { UserAvatar } from "@/components/mcm/user-avatar";
import { MCMAvatar, StatusBadge } from "./primitives";

export const EMOJIS = [
  "😀",
  "😁",
  "😂",
  "🥹",
  "😍",
  "🤝",
  "👍",
  "🙏",
  "🔥",
  "☕",
  "💰",
  "✅",
  "❤️",
  "🎉",
  "😅",
  "🤔",
];

/**
 * Centang status pesan keluar — sumber kebenarannya `message_receipts`:
 * `sent` ✓ (tersimpan di server) · `delivered` ✓✓ netral · `read` ✓✓ aksen.
 */
export function MessageTicks({ status, className }: { status: MessageStatus; className?: string }) {
  const label =
    status === "read"
      ? "Sudah dibaca"
      : status === "delivered"
        ? "Sampai di perangkat penerima"
        : "Terkirim ke server";
  const Icon = status === "sent" ? Check : CheckCheck;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-status={status}
      className={cn("inline-flex", className)}
    >
      <Icon className={cn("size-3.5", status === "read" && "text-tick-read")} />
    </span>
  );
}

const initialsOf = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "MC";

export function ChatListItem({
  conv,
  time,
  outgoingStatus,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
}: {
  conv: ConversationView;
  time: string;
  outgoingStatus?: MessageStatus | undefined;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onToggleArchive: () => void;
}) {
  const name = conv.title_resolved;
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 active:bg-muted/60">
      <Link
        to="/chat/$id"
        params={{ id: conv.id }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {conv.other ? (
          <UserAvatar
            userId={conv.other.id}
            path={conv.other.avatar_url}
            version={conv.other.avatar_version ?? 0}
            name={name}
            color={conv.other.avatar_color}
          />
        ) : (
          <MCMAvatar initials={initialsOf(name)} color="#0ea5e9" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">
              {name}
            </p>
            {conv.me.is_pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
            {conv.me.is_muted && <BellOff className="size-3 shrink-0 text-muted-foreground" />}
            {conv.type === "group" && <StatusBadge tone="primary">Grup</StatusBadge>}
            <span
              className={cn(
                "ml-auto shrink-0 text-[11px]",
                conv.unread > 0 ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {time}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {outgoingStatus && (
              <MessageTicks status={outgoingStatus} className="shrink-0 text-muted-foreground" />
            )}
            <p
              className={cn(
                "truncate text-[13px] leading-4",
                conv.unread > 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {previewOf(conv.lastMessage)}
            </p>
            {conv.unread > 0 && (
              <span className="ml-auto min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[10px] leading-5 font-bold text-primary-foreground">
                {conv.unread}
              </span>
            )}
          </div>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`Opsi ${name}`}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onTogglePin}>
            <Pin className="size-4" /> {conv.me.is_pinned ? "Lepas pin" : "Sematkan"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleMute}>
            <BellOff className="size-4" /> {conv.me.is_muted ? "Bunyikan" : "Bisukan"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleArchive}>
            <Archive className="size-4" />{" "}
            {conv.me.is_archived ? "Keluarkan dari arsip" : "Arsipkan"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Kartu lokasi yang menyatu dengan pesan foto/lokasi. */
export function MessageLocationCard({
  message,
  compact,
}: {
  message: MessageRow;
  compact?: boolean;
}) {
  if (message.location_lat == null || message.location_lng == null) return null;
  const url =
    message.location_maps_url ||
    `https://www.google.com/maps/search/?api=1&query=${message.location_lat},${message.location_lng}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mt-1 flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-2 py-1.5 text-foreground",
        compact ? "text-[11px]" : "text-xs",
      )}
    >
      <MapPin className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {message.location_label || "Lokasi terlampir"}
        </span>
        <span className="block truncate text-muted-foreground">
          {message.location_lat.toFixed(5)}, {message.location_lng.toFixed(5)}
          {message.location_accuracy ? ` • ±${Math.round(message.location_accuracy)} m` : ""}
        </span>
      </span>
      <span className="shrink-0 font-semibold text-primary">Buka Maps</span>
    </a>
  );
}

type SalesCardPhoto = {
  id: string;
  location_url?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  location_label?: string | null;
};

type SalesCardItem = {
  name: string;
  variantName?: string;
  unit?: string;
  qty: number;
  price: number;
  discount: number;
  photos?: SalesCardPhoto[];
};

const PAYMENT_LABEL_ID: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer",
  dp: "DP / uang muka",
  credit: "Kredit / tempo",
};

function SalesCardPhotoThumb({ photo }: { photo: SalesCardPhoto }) {
  const url = useSignedUrl(
    "product-photos",
    (photo as { image_path?: string }).image_path ?? photo.id,
  );
  const mapsUrl =
    photo.location_url ||
    (photo.location_lat != null && photo.location_lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${photo.location_lat},${photo.location_lng}`
      : "");
  return (
    <div className="w-20 shrink-0 space-y-1">
      <div className="size-20 overflow-hidden rounded-lg bg-black/10">
        {url ? (
          <img src={url} alt="Foto produk" className="size-full object-cover" />
        ) : (
          <div className="size-full animate-pulse" />
        )}
      </div>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-0.5 truncate text-[10px] font-semibold text-primary"
        >
          <MapPin className="size-3 shrink-0" /> Buka Lokasi
        </a>
      )}
    </div>
  );
}

/** Kutipan slide status pada balasan/reaksi yang dikirim dari viewer status. */
function StatusReplyQuote({ message }: { message: MessageRow }) {
  const p = (message.payload ?? {}) as {
    type?: string;
    preview?: string;
    thumbPath?: string | null;
  };
  const { data: url } = useStatusMedia(p.type === "status_reply" ? p.thumbPath : null);
  if (p.type !== "status_reply") return null;
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-lg border-l-2 border-primary bg-black/10 px-2 py-1 text-[11px]">
      {url ? (
        <img src={url} alt="" className="size-8 rounded object-cover" />
      ) : (
        <div className="size-8 rounded bg-black/20" />
      )}
      <span className="min-w-0">
        <span className="block font-medium">Membalas status</span>
        <span className="line-clamp-1 opacity-80">{p.preview}</span>
      </span>
    </div>
  );
}

type ProductCardData = {
  businessId?: string;
  productId?: string;
  variantId?: string | null;
  productName?: string;
  variantName?: string;
  price?: number;
  unit?: string;
  stockLabel?: string;
  perUnitQty?: number;
  perUnitUnit?: string;
  availableUnitCount?: number;
  availableQtyDisplay?: number;
  description?: string;
  note?: string;
  photos?: SalesCardPhoto[];
};

/** Kartu produk terstruktur: nama, varian, harga, stok, dan foto + lokasi per foto. */
function ProductCard({ message }: { message: MessageRow }) {
  const p = (message.payload ?? {}) as ProductCardData;
  const photos = p.photos ?? [];
  const perUnitLabel =
    p.perUnitQty && p.perUnitQty > 0
      ? `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(p.perUnitQty)} ${
          p.perUnitUnit ?? p.unit ?? ""
        }`.trim()
      : "";
  const availableUnits = Number(p.availableUnitCount ?? 0);
  return (
    <div className="w-64 max-w-[78vw] space-y-2">
      <p className="text-[10px] font-bold tracking-wide uppercase opacity-70">Produk</p>
      <div>
        <p className="text-sm font-bold break-words">{p.productName ?? message.body}</p>
        {p.variantName && <p className="text-[11px] opacity-80">Varian: {p.variantName}</p>}
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="font-semibold">{rupiah(Number(p.price ?? 0))}</span>
        {p.unit && <span className="opacity-75">per {p.unit}</span>}
      </div>
      {perUnitLabel && <p className="text-[11px] opacity-80">Isi per unit: {perUnitLabel}</p>}
      {p.stockLabel && <p className="text-[11px] opacity-80">Stok tersedia: {p.stockLabel}</p>}
      {p.description && <p className="line-clamp-3 text-[11px] opacity-80">{p.description}</p>}
      {photos.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {photos.map((ph) => (
            <SalesCardPhotoThumb key={ph.id} photo={ph} />
          ))}
        </div>
      )}
      {p.note && <p className="text-[11px] break-words opacity-90">{p.note}</p>}
      {p.businessId && p.variantId && (
        <OrderFromProductButton
          businessId={p.businessId}
          variantId={p.variantId}
          conversationId={message.conversation_id}
          perUnitLabel={perUnitLabel}
          availableUnits={availableUnits}
        />
      )}
    </div>
  );
}

function SalesCard({ message }: { message: MessageRow }) {
  const p = (message.payload ?? {}) as {
    number?: string;
    total?: number;
    paid?: number;
    outstanding?: number;
    dueDate?: string | null;
    paymentMethod?: string;
    note?: string;
    items?: SalesCardItem[];
  };
  return (
    <div className="w-64 max-w-[78vw] space-y-2">
      <p className="text-xs font-bold">Rincian penjualan {p.number}</p>
      <ul className="space-y-2 text-[11px]">
        {(p.items ?? []).map((i, idx) => (
          <li key={idx} className="space-y-1">
            <div className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {i.name}
                {i.variantName ? ` — ${i.variantName}` : ""} × {i.qty} {i.unit ?? ""}
              </span>
              <span className="shrink-0">{rupiah(Math.max(0, i.price - i.discount) * i.qty)}</span>
            </div>
            {i.discount > 0 && (
              <div className="text-[10px] opacity-75">Diskon item {rupiah(i.discount)}</div>
            )}
            {(i.photos ?? []).length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {(i.photos ?? []).map((ph) => (
                  <SalesCardPhotoThumb key={ph.id} photo={ph} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="space-y-0.5 border-t border-current/20 pt-1.5 text-[11px]">
        <div className="flex justify-between font-semibold">
          <span>Total</span>
          <span>{rupiah(p.total ?? 0)}</span>
        </div>
        <div className="flex justify-between">
          <span>Metode</span>
          <span>{PAYMENT_LABEL_ID[p.paymentMethod ?? ""] ?? "-"}</span>
        </div>
        <div className="flex justify-between">
          <span>Dibayar</span>
          <span>{rupiah(p.paid ?? 0)}</span>
        </div>
        {(p.outstanding ?? 0) > 0 && (
          <div className="flex justify-between font-semibold">
            <span>Sisa</span>
            <span>{rupiah(p.outstanding ?? 0)}</span>
          </div>
        )}
        {p.dueDate && (
          <div className="flex justify-between">
            <span>Jatuh tempo</span>
            <span>{p.dueDate}</span>
          </div>
        )}
        {p.note && <p className="pt-0.5 break-words opacity-85">Catatan: {p.note}</p>}
      </div>
    </div>
  );
}

function ImageBubble({ message }: { message: MessageRow }) {
  const url = useSignedUrl("chat-media", message.attachment_path);
  return url ? (
    <img
      src={url}
      alt={message.body || "Foto terkirim"}
      loading="lazy"
      className="max-h-56 w-52 max-w-full rounded-xl object-cover"
    />
  ) : (
    <div className="flex h-28 w-44 items-center justify-center rounded-xl bg-black/15">
      <ImageIcon className="size-7 opacity-70" />
    </div>
  );
}

function DocumentBubble({ message }: { message: MessageRow }) {
  const url = useSignedUrl("chat-media", message.attachment_path);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2">
      <FileText className="size-5 shrink-0" />
      <span className="break-all">{message.attachment_name ?? message.body}</span>
    </a>
  );
}

function StickerBubble({ message }: { message: MessageRow }) {
  const url = useSignedUrl("chat-media", message.attachment_path);
  return url ? (
    <img
      src={url}
      alt={message.body || "Stiker"}
      loading="lazy"
      className="size-32 object-contain"
    />
  ) : (
    <div className="size-32 rounded-2xl bg-black/10" />
  );
}

function VoiceBubble({ message }: { message: MessageRow }) {
  const url = useSignedUrl("chat-media", message.attachment_path);
  return (
    <div className="flex w-52 items-center gap-2">
      <Mic className="size-4 shrink-0" />
      {url ? (
        <audio controls src={url} className="h-8 w-full" />
      ) : (
        <span className="text-[11px]">Memuat suara…</span>
      )}
    </div>
  );
}

export type MessageAction =
  "select" | "reply" | "forward" | "copy" | "edit" | "react" | "delete-me" | "delete-all";

/** Ambang geser (px) sebelum aksi balas/teruskan dijalankan. */
const SWIPE_TRIGGER_PX = 64;
const SWIPE_MAX_PX = 96;

/**
 * Gestur geser pada bubble: geser kanan = balas, geser kiri = teruskan.
 * Hanya aktif untuk gerakan yang jelas horizontal agar scroll vertikal daftar
 * pesan tidak pernah tertahan.
 */
function useBubbleSwipe(onSwipe: (dir: "right" | "left") => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");
  const [dx, setDx] = useState(0);

  const clamp = (v: number) => Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, v));

  return {
    dx,
    handlers: {
      onTouchStart: (e: ReactTouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        start.current = { x: t.clientX, y: t.clientY };
        axis.current = "none";
      },
      onTouchMove: (e: ReactTouchEvent) => {
        const t = e.touches[0];
        const s = start.current;
        if (!t || !s) return;
        const mx = t.clientX - s.x;
        const my = t.clientY - s.y;
        if (axis.current === "none") {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
          axis.current = Math.abs(mx) > Math.abs(my) * 1.4 ? "x" : "y";
        }
        if (axis.current !== "x") return;
        setDx(clamp(mx * 0.6));
      },
      onTouchEnd: () => {
        const moved = dx;
        start.current = null;
        axis.current = "none";
        setDx(0);
        if (moved >= SWIPE_TRIGGER_PX * 0.6) onSwipe("right");
        else if (moved <= -SWIPE_TRIGGER_PX * 0.6) onSwipe("left");
      },
      onTouchCancel: () => {
        start.current = null;
        axis.current = "none";
        setDx(0);
      },
    },
  };
}

export function MessageBubble({
  message,
  replyTo,
  senderName,
  replySenderName,
  mine,
  showSender,
  reactions,
  status,
  onAction,
  selectable,
  selected,
  highlighted,
  grouped,
}: {
  message: MessageRow;
  replyTo?: MessageRow | undefined;
  senderName: string;
  replySenderName?: string | undefined;
  mine: boolean;
  showSender: boolean;
  reactions: string[];
  status: MessageStatus;
  onAction: (action: MessageAction, message: MessageRow, payload?: string) => void;
  selectable?: boolean | undefined;
  selected?: boolean | undefined;
  highlighted?: boolean | undefined;
  grouped?: boolean | undefined;
}) {
  const isSticker = message.kind === "sticker";
  const swipe = useBubbleSwipe((dir) => onAction(dir === "right" ? "reply" : "forward", message));
  if (message.kind === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-muted/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
          {message.body}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "group animate-bubble-in relative flex w-full gap-1 rounded-2xl px-1 transition-colors",
        grouped ? "py-[1px]" : "pt-1.5 pb-[1px]",
        mine ? "justify-end" : "justify-start",
        selectable && "cursor-pointer",
        selectable && selected && "bg-primary/10",
        highlighted && "ring-2 ring-primary/60",
      )}
      style={{
        transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined,
        transition: swipe.dx ? "none" : "transform 160ms ease-out",
      }}
      {...(selectable ? {} : swipe.handlers)}
      onClick={selectable ? () => onAction("select", message) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onAction("select", message);
      }}
    >
      {swipe.dx !== 0 && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
            swipe.dx > 0 ? "-left-8" : "-right-8",
          )}
        >
          {swipe.dx > 0 ? <CornerUpLeft className="size-5" /> : <Forward className="size-5" />}
        </span>
      )}
      <div className={cn("flex min-w-0 max-w-[80%] flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "relative min-w-0 max-w-full rounded-2xl px-3 py-2 text-[14.5px] leading-[1.45] [overflow-wrap:anywhere]",
            isSticker
              ? "bg-transparent px-0 py-0 shadow-none"
              : mine
                ? cn(
                    "bubble-elevate",
                    "bg-bubble-out text-bubble-out-foreground",
                    grouped ? "rounded-br-lg" : "rounded-br-sm",
                  )
                : cn(
                    "bubble-elevate",
                    "border border-border/70 bg-bubble-in text-bubble-in-foreground",
                    grouped ? "rounded-bl-lg" : "rounded-bl-sm",
                  ),
          )}
        >
          {showSender && !mine && !grouped && (
            <p className="mb-0.5 text-[11px] font-semibold text-primary">{senderName}</p>
          )}
          {replyTo && (
            <div
              className={cn(
                "mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[11px]",
                mine ? "border-current/50 bg-black/10" : "border-primary bg-muted",
              )}
            >
              <span className="font-medium">{replySenderName ?? "Pesan"}</span>
              <p className="line-clamp-2 opacity-80">{previewOf(replyTo)}</p>
            </div>
          )}
          {message.kind === "document" ? (
            <DocumentBubble message={message} />
          ) : isSticker ? (
            <StickerBubble message={message} />
          ) : message.kind === "image" ? (
            <div className="space-y-1">
              <ImageBubble message={message} />
              {message.body && (
                <LinkifiedText
                  text={message.body}
                  onBubble={mine}
                  className="block w-52 max-w-full break-words"
                />
              )}
              <div className="w-52 max-w-full">
                <MessageLocationCard message={message} compact />
              </div>
            </div>
          ) : message.kind === "voice" ? (
            <VoiceBubble message={message} />
          ) : message.kind === "sales_card" ? (
            <SalesCard message={message} />
          ) : message.kind === "product_card" ? (
            <ProductCard message={message} />
          ) : message.kind === "order" && chatOrderIdOf(message) ? (
            <ChatOrderCard orderId={chatOrderIdOf(message)!} />
          ) : message.kind === "ledger" ? (
            <div className="flex w-52 items-center gap-2">
              <Wallet className="size-5 shrink-0" />
              <span>{message.body}</span>
            </div>
          ) : message.kind === "location" ? (
            <div className="w-52">
              <MessageLocationCard message={message} />
            </div>
          ) : (
            <>
              <StatusReplyQuote message={message} />
              <p className="break-words whitespace-pre-wrap">
                <LinkifiedText text={message.body} onBubble={mine} />
              </p>
            </>
          )}
          <div
            className={cn(
              "mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums",
              isSticker ? "text-muted-foreground" : mine ? "opacity-85" : "text-muted-foreground",
            )}
          >
            {message.edited_at && <span>diedit</span>}
            <span>{jam(message.created_at)}</span>
            {mine && <MessageTicks status={status} />}
          </div>
        </div>
        {reactions.length > 0 && (
          <div className="bubble-elevate -mt-1.5 flex gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs">
            {reactions.map((r, i) => (
              <span key={i}>{r}</span>
            ))}
          </div>
        )}
      </div>
      {!selectable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 self-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-60"
              aria-label="Opsi pesan"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? "end" : "start"}>
            <div className="flex gap-1 px-1 pb-1">
              {[
                ["👍", "Suka"],
                ["❤️", "Cinta"],
                ["😂", "Tertawa"],
                ["🙏", "Terima kasih"],
                ["🔥", "Keren"],
              ].map(([e, label]) => (
                <button
                  key={e}
                  type="button"
                  aria-label={`Reaksi ${label}`}
                  className="flex size-11 items-center justify-center rounded-md text-lg hover:bg-muted"
                  onClick={() => onAction("react", message, e)}
                >
                  {e}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction("reply", message)}>
              <CornerUpLeft className="size-4" /> Balas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("forward", message)}>
              <Forward className="size-4" /> Teruskan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("copy", message)}>
              <Copy className="size-4" /> Salin
            </DropdownMenuItem>
            {mine && message.kind === "text" && (
              <DropdownMenuItem onClick={() => onAction("edit", message)}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onAction("select", message)}>
              <CheckCheck className="size-4" /> Pilih pesan
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction("delete-me", message)}>
              <Trash2 className="size-4" /> Hapus untuk saya
            </DropdownMenuItem>
            {mine && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onAction("delete-all", message)}
              >
                <Trash2 className="size-4 text-destructive" /> Hapus untuk semua
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Perekam pesan suara asli memakai MediaRecorder; hasilnya diunggah sebagai lampiran. */
function useVoiceRecorder(onDone: (blob: Blob, seconds: number) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  // Guard sinkron: tap cepat pada tombol mic tidak boleh memicu dua
  // getUserMedia / dua MediaRecorder sekaligus.
  const busy = useRef(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    setPreparing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recorder.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        onDone(blob, Math.max(1, Math.round((Date.now() - started.current) / 1000)));
      };
      started.current = Date.now();
      setSeconds(0);
      mr.start();
      recorder.current = mr;
      setRecording(true);
    } catch {
      toast.error("Tidak bisa mengakses mikrofon. Izinkan akses lalu coba lagi.");
    } finally {
      busy.current = false;
      setPreparing(false);
    }
  };

  const stop = () => {
    if (busy.current) return;
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  return { recording, preparing, seconds, start, stop };
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onAttach,
  onVoice,
  onNewLedger,
  onNewSale,
  onSendProduct,
  onNewPreparation,
  onLocation,
  onSticker,
  editing,
  onCancelEdit,
  replyPreview,
  replySenderName,
  onCancelReply,
  quickReplies,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void | Promise<void>;
  onAttach: (kind: "image" | "document" | "camera") => void;
  onVoice: (blob: Blob, seconds: number) => void;
  onNewLedger: () => void;
  onNewSale?: (() => void) | undefined;
  onSendProduct?: (() => void) | undefined;
  onNewPreparation?: (() => void) | undefined;
  onLocation?: (() => void) | undefined;
  onSticker?: (() => void) | undefined;
  editing?: boolean | undefined;
  onCancelEdit?: (() => void) | undefined;
  replyPreview?: MessageRow | undefined;
  replySenderName?: string | undefined;
  onCancelReply?: (() => void) | undefined;
  quickReplies?: { shortcut: string; text: string }[] | undefined;
  disabled?: boolean | undefined;
}) {
  const { recording, preparing, seconds, start, stop } = useVoiceRecorder(onVoice);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  useBackDismiss(actionsOpen, () => setActionsOpen(false));
  useBackDismiss(emojiOpen, () => setEmojiOpen(false));
  // Guard sinkron anti double-tap kirim; outbox tidak diubah.
  const sendLock = useRef(false);
  const [sending, setSending] = useState(false);
  const submit = () => {
    if (sendLock.current || disabled || !value.trim()) return;
    sendLock.current = true;
    setSending(true);
    const release = () => {
      sendLock.current = false;
      setSending(false);
    };
    // Lepas lock paling cepat pada frame berikutnya agar dua klik/Enter
    // sinkron (microtask yang sama) tidak lolos jadi dua kiriman.
    const releaseNextFrame = () => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(release);
      else setTimeout(release, 16);
    };
    try {
      void Promise.resolve(onSend()).finally(releaseNextFrame);
    } catch {
      releaseNextFrame();
    }
  };
  const runAction = (fn?: () => void) => {
    setActionsOpen(false);
    fn?.();
  };
  const matches = value.startsWith("/")
    ? (quickReplies ?? []).filter((q) =>
        q.shortcut.toLowerCase().startsWith(value.trim().toLowerCase()),
      )
    : [];
  const [quickIdx, setQuickIdx] = useState(0);
  const [quickDismissed, setQuickDismissed] = useState(false);
  const quickOpen = matches.length > 0 && !quickDismissed;
  const activeQuick = quickOpen ? matches[Math.min(quickIdx, matches.length - 1)] : undefined;
  useEffect(() => {
    setQuickIdx(0);
    setQuickDismissed(false);
  }, [value]);

  const pickQuick = (text: string) => {
    onChange(text);
    setQuickDismissed(true);
  };

  /** Pintasan keyboard composer: kirim, pilih QuickReply, buka lampiran. */
  const onComposerKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      setActionsOpen(true);
      return;
    }
    if (mod && e.shiftKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      onAttach("camera");
      return;
    }
    if (mod && e.shiftKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      onAttach("document");
      return;
    }
    if (quickOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setQuickIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setQuickIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuickDismissed(true);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        if (activeQuick) {
          e.preventDefault();
          pickQuick(activeQuick.text);
          return;
        }
      }
    }
    if (e.key === "Enter" && (!e.shiftKey || mod)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer-raise sticky bottom-0 z-20 shrink-0 border-t border-border/70 bg-card/92 pb-[max(env(safe-area-inset-bottom),var(--mcm-kb,0px))] backdrop-blur-xl">
      {quickOpen && (
        <div
          id="composer-quick-replies"
          role="listbox"
          aria-label="Balasan cepat"
          className="max-h-40 overflow-y-auto border-b border-border/70"
        >
          {matches.map((q, i) => (
            <button
              key={q.shortcut}
              type="button"
              id={`quick-reply-${i}`}
              role="option"
              aria-selected={i === Math.min(quickIdx, matches.length - 1)}
              className={cn(
                "block w-full px-4 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                i === Math.min(quickIdx, matches.length - 1) && "bg-muted",
              )}
              onFocus={() => setQuickIdx(i)}
              onClick={() => pickQuick(q.text)}
            >
              <span className="text-xs font-semibold text-primary">{q.shortcut}</span>
              <span className="block truncate text-xs text-muted-foreground">{q.text}</span>
            </button>
          ))}
        </div>
      )}
      {replyPreview && (
        <div
          data-testid="reply-preview"
          className="flex items-center gap-2 border-b border-border/70 bg-muted/50 px-3 py-2"
        >
          <CornerUpLeft className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">{replySenderName ?? "Pesan"}</p>
            <p className="truncate text-xs text-muted-foreground">{previewOf(replyPreview)}</p>
          </div>
          <Button variant="ghost" size="sm" className="min-h-11 px-3" onClick={onCancelReply}>
            Batal
          </Button>
        </div>
      )}
      {editing && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 border-b border-border/70 bg-warning/15 px-3 py-2 text-xs"
        >
          <Pencil className="size-4" /> Mengedit pesan
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto min-h-11 px-3"
            onClick={onCancelEdit}
          >
            Batal
          </Button>
        </div>
      )}
      {recording && (
        <div
          role="status"
          aria-live="assertive"
          className="flex items-center gap-2 border-b border-border/70 bg-destructive/10 px-3 py-2 text-xs font-medium"
        >
          <span className="size-2 animate-pulse rounded-full bg-destructive" /> Merekam… {seconds}s
        </div>
      )}
      <div className="flex items-end gap-1.5 px-2.5 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="size-11 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Tindakan lain"
          disabled={disabled}
          onClick={() => setActionsOpen(true)}
        >
          <Plus className="size-5" />
        </Button>
        <Sheet open={actionsOpen} onOpenChange={setActionsOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl">
            <SheetHeader>
              <SheetTitle>Tindakan</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-3 px-1 pb-6">
              {[
                { icon: Camera, label: "Foto/Kamera", fn: () => onAttach("camera") },
                { icon: ImageIcon, label: "Foto & lokasi", fn: () => onAttach("image") },
                ...(onSticker ? [{ icon: Sticker, label: "Stiker", fn: onSticker }] : []),
                ...(onLocation ? [{ icon: MapPin, label: "Lokasi", fn: onLocation }] : []),
                ...(onSendProduct
                  ? [{ icon: Package, label: "Kirim Produk", fn: onSendProduct }]
                  : []),
                ...(onNewSale ? [{ icon: ShoppingCart, label: "Penjualan", fn: onNewSale }] : []),
                { icon: Wallet, label: "Catat Utang/Piutang", fn: onNewLedger },
                ...(onNewPreparation
                  ? [{ icon: ClipboardList, label: "Buat Penyiapan", fn: onNewPreparation }]
                  : []),
                { icon: Paperclip, label: "Dokumen", fn: () => onAttach("document") },
              ].map(({ icon: Icon, label, fn }) => (
                <Button
                  key={label}
                  type="button"
                  variant="ghost"
                  onClick={() => runAction(fn)}
                  className="h-auto min-h-28 whitespace-normal flex-col gap-1.5 rounded-2xl border border-border p-3 text-center hover:bg-muted"
                >
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-[11px] leading-tight font-medium">{label}</span>
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex flex-1 items-end rounded-3xl border border-input bg-background px-1.5 transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20">
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 rounded-full text-muted-foreground"
                aria-label="Emoji"
                disabled={disabled}
              >
                <Smile className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 rounded-2xl p-2">
              <div className="grid grid-cols-8 gap-1">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="rounded-md p-1 text-lg hover:bg-muted"
                    onClick={() => onChange(value + e)}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Textarea
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onComposerKeyDown}
            aria-label="Tulis pesan"
            aria-keyshortcuts="Enter Control+Enter Control+Shift+A Control+Shift+C Control+Shift+D"
            aria-describedby="composer-shortcut-help"
            role="combobox"
            aria-expanded={quickOpen}
            aria-controls={quickOpen ? "composer-quick-replies" : undefined}
            aria-activedescendant={
              quickOpen ? `quick-reply-${Math.min(quickIdx, matches.length - 1)}` : undefined
            }
            rows={1}
            placeholder="Tulis pesan…"
            className="max-h-32 min-h-10 resize-none border-0 bg-transparent px-1 py-2.5 text-[15px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <span id="composer-shortcut-help" className="sr-only">
            Enter untuk mengirim, Shift+Enter baris baru, panah atas bawah memilih balasan cepat,
            Ctrl+Shift+A membuka menu lampiran, Ctrl+Shift+C kamera, Ctrl+Shift+D dokumen.
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-full text-muted-foreground"
            aria-label="Kamera"
            disabled={disabled}
            onClick={() => onAttach("camera")}
          >
            <Camera className="size-5" />
          </Button>
        </div>
        {value.trim() ? (
          <Button
            size="icon"
            className="size-11 shrink-0 rounded-full shadow-sm transition-transform active:scale-95"
            aria-label="Kirim"
            disabled={disabled || sending}
            onClick={submit}
          >
            <Send className="size-4.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant={recording ? "destructive" : "default"}
            className="size-11 shrink-0 rounded-full shadow-sm transition-transform active:scale-95"
            aria-label={recording ? "Hentikan rekaman" : "Rekam pesan suara"}
            disabled={disabled || preparing}
            onClick={() => (recording ? stop() : void start())}
          >
            {recording ? <Square className="size-4" /> : <Mic className="size-4.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Kartu pesanan chat menyimpan id pesanan pada payload pesan. */
function chatOrderIdOf(message: { payload: unknown }): string | null {
  const p = message.payload as { chatOrderId?: unknown } | null;
  return typeof p?.chatOrderId === "string" ? p.chatOrderId : null;
}

/**
 * Pembeli memesan langsung dari kartu produk. Satu ketuk membuat pesanan chat
 * berstatus `buyer_requested`; idempotency key mencegah pesanan ganda.
 */
function OrderFromProductButton({
  businessId,
  variantId,
  conversationId,
  perUnitLabel,
  availableUnits,
}: {
  businessId: string;
  variantId: string;
  conversationId: string;
  perUnitLabel: string;
  availableUnits: number;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(crypto.randomUUID());

  const submit = async () => {
    if (saving) return;
    const c = Number(count);
    if (!Number.isInteger(c) || c <= 0) {
      toast.error("Jumlah unit tidak valid");
      return;
    }
    setSaving(true);
    try {
      await createChatOrder({
        businessId,
        conversationId,
        idempotencyKey: keyRef.current,
        note: note.trim(),
        // Isi per unit sengaja tidak dikirim: server memakai definisi varian.
        items: [{ variantId, unitCount: c }],
      });
      toast.success("Pesanan dikirim ke toko");
      setOpen(false);
    } catch (err) {
      keyRef.current = crypto.randomUUID();
      toast.error(err instanceof Error ? err.message : "Gagal mengirim pesanan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" className="h-9 w-full rounded-lg text-[11px]" onClick={() => setOpen(true)}>
        Pesan sekarang
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Pesan produk</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Jumlah unit</Label>
              <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
              {availableUnits > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {availableUnits} unit siap kirim. Sisanya disiapkan pegawai lebih dulu.
                </p>
              )}
            </div>
            {perUnitLabel && (
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-[12px]">
                Isi per unit: <span className="font-semibold">{perUnitLabel}</span>
                <span className="block text-[11px] text-muted-foreground">
                  Ditetapkan toko pada varian ini.
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tiap unit disiapkan dan difoto terpisah oleh pegawai toko sebelum dikirim.
            </p>
          </div>
          <DialogFooter>
            <Button className="w-full rounded-xl" disabled={saving} onClick={() => void submit()}>
              {saving ? "Mengirim…" : "Kirim pesanan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
