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
import { cn } from "@/lib/utils";
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
  productName?: string;
  variantName?: string;
  price?: number;
  unit?: string;
  stockLabel?: string;
  description?: string;
  note?: string;
  photos?: SalesCardPhoto[];
};

/** Kartu produk terstruktur: nama, varian, harga, stok, dan foto + lokasi per foto. */
function ProductCard({ message }: { message: MessageRow }) {
  const p = (message.payload ?? {}) as ProductCardData;
  const photos = p.photos ?? [];
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
  "select" | "reply" | "copy" | "edit" | "react" | "delete-me" | "delete-all";

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
  if (message.kind === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-muted/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
          {message.body}
        </span>
      </div>
    );
  }
  const isSticker = message.kind === "sticker";
  return (
    <div
      className={cn(
        "group animate-bubble-in flex w-full gap-1 rounded-2xl px-1 transition-colors",
        grouped ? "py-[1px]" : "pt-1.5 pb-[1px]",
        mine ? "justify-end" : "justify-start",
        selectable && "cursor-pointer",
        selectable && selected && "bg-primary/10",
        highlighted && "ring-2 ring-primary/60",
      )}
      onClick={selectable ? () => onAction("select", message) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onAction("select", message);
      }}
    >
      <div className={cn("flex max-w-[80%] flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "relative rounded-2xl px-3 py-2 text-[14.5px] leading-[1.45]",
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
                <span className="block w-52 max-w-full break-words">{message.body}</span>
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
              <p className="break-words whitespace-pre-wrap">{message.body}</p>
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
              className="size-7 self-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-60"
              aria-label="Opsi pesan"
            >
              <MoreVertical className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? "end" : "start"}>
            <div className="flex gap-1 px-1 pb-1">
              {["👍", "❤️", "😂", "🙏", "🔥"].map((e) => (
                <button
                  key={e}
                  type="button"
                  className="rounded-md px-1.5 py-1 text-base hover:bg-muted"
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

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    }
  };

  const stop = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  return { recording, seconds, start, stop };
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
  onSend: () => void;
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
  const { recording, seconds, start, stop } = useVoiceRecorder(onVoice);
  const [actionsOpen, setActionsOpen] = useState(false);
  const runAction = (fn?: () => void) => {
    setActionsOpen(false);
    fn?.();
  };
  const matches = value.startsWith("/")
    ? (quickReplies ?? []).filter((q) =>
        q.shortcut.toLowerCase().startsWith(value.trim().toLowerCase()),
      )
    : [];

  return (
    <div className="composer-raise sticky bottom-0 z-20 shrink-0 border-t border-border/70 bg-card/92 pb-[max(env(safe-area-inset-bottom),var(--mcm-kb,0px))] backdrop-blur-xl">
      {matches.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-b border-border/70">
          {matches.map((q) => (
            <button
              key={q.shortcut}
              type="button"
              className="block w-full px-4 py-2 text-left transition-colors hover:bg-muted"
              onClick={() => onChange(q.text)}
            >
              <span className="text-xs font-semibold text-primary">{q.shortcut}</span>
              <span className="block truncate text-xs text-muted-foreground">{q.text}</span>
            </button>
          ))}
        </div>
      )}
      {replyPreview && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/50 px-3 py-2">
          <CornerUpLeft className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">{replySenderName ?? "Pesan"}</p>
            <p className="truncate text-xs text-muted-foreground">{previewOf(replyPreview)}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancelReply}>
            Batal
          </Button>
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-warning/15 px-3 py-2 text-xs">
          <Pencil className="size-4" /> Mengedit pesan
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancelEdit}>
            Batal
          </Button>
        </div>
      )}
      {recording && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-destructive/10 px-3 py-2 text-xs font-medium">
          <span className="size-2 animate-pulse rounded-full bg-destructive" /> Merekam… {seconds}s
        </div>
      )}
      <div className="flex items-end gap-1.5 px-2.5 py-2.5">
        <Button
          variant="ghost"
          size="icon"
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
                <button
                  key={label}
                  type="button"
                  onClick={() => runAction(fn)}
                  className="flex flex-col items-center gap-1.5 rounded-2xl border border-border p-3 text-center hover:bg-muted"
                >
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-[11px] leading-tight font-medium">{label}</span>
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex flex-1 items-end rounded-3xl border border-input bg-background px-1.5 transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20">
          <Popover>
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Tulis pesan…"
            className="max-h-32 min-h-10 resize-none border-0 bg-transparent px-1 py-2.5 text-[15px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
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
            disabled={disabled}
            onClick={onSend}
          >
            <Send className="size-4.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant={recording ? "destructive" : "default"}
            className="size-11 shrink-0 rounded-full shadow-sm transition-transform active:scale-95"
            aria-label={recording ? "Hentikan rekaman" : "Rekam pesan suara"}
            disabled={disabled}
            onClick={() => (recording ? stop() : void start())}
          >
            {recording ? <Square className="size-4" /> : <Mic className="size-4.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}
