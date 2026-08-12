import { Link } from "@tanstack/react-router";
import {
  Archive,
  BellOff,
  Camera,
  Check,
  CheckCheck,
  CornerUpLeft,
  Copy,
  FileText,
  Image as ImageIcon,
  Mic,
  MoreVertical,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Send,
  Share,
  Smile,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import { useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { jam } from "@/lib/mcm/format";
import type { Chat, Message } from "@/lib/mcm/types";
import { MCMAvatar, StatusBadge } from "./primitives";

export const EMOJIS = ["😀", "😁", "😂", "🥹", "😍", "🤝", "👍", "🙏", "🔥", "☕", "💰", "✅", "❤️", "🎉", "😅", "🤔"];

export function ChatListItem({
  chat,
  preview,
  time,
  outgoing,
  onTogglePin,
  onToggleMute,
  onToggleArchive,
}: {
  chat: Chat;
  preview: string;
  time: string;
  outgoing?: boolean | undefined;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onToggleArchive: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
      <Link to="/chat/$id" params={{ id: chat.id }} className="flex min-w-0 flex-1 items-center gap-3">
        <MCMAvatar initials={chat.initials} color={chat.avatarColor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{chat.name}</p>
            {chat.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
            {chat.muted && <BellOff className="size-3 shrink-0 text-muted-foreground" />}
            {chat.isBusiness && <StatusBadge tone="primary">Bisnis</StatusBadge>}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{time}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {chat.typing ? (
              <p className="truncate text-xs font-medium text-primary">sedang mengetik…</p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                {outgoing && <span className="mr-1 text-primary">✓✓</span>}
                {preview}
              </p>
            )}
            {chat.unread > 0 && (
              <span className="ml-auto min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[10px] leading-5 font-bold text-primary-foreground">
                {chat.unread}
              </span>
            )}
          </div>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Opsi ${chat.name}`}>
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onTogglePin}>
            <Pin className="size-4" /> {chat.pinned ? "Lepas pin" : "Sematkan"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleMute}>
            <BellOff className="size-4" /> {chat.muted ? "Bunyikan" : "Bisukan"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleArchive}>
            <Archive className="size-4" /> {chat.archived ? "Keluarkan dari arsip" : "Arsipkan"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function MessageBubble({
  message,
  replyTo,
  showSender,
  onAction,
}: {
  message: Message;
  replyTo?: Message | undefined;
  showSender: boolean;
  onAction: (action: string, message: Message, payload?: string) => void | undefined;
}) {
  const mine = message.senderId === "me";
  if (message.kind === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{message.text}</span>
      </div>
    );
  }
  return (
    <div className={cn("group flex w-full gap-1", mine ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[82%] flex-col", mine ? "items-end" : "items-start")}>
        <div
          className={cn(
            "relative rounded-2xl px-3 py-2 text-sm shadow-sm",
            mine
              ? "rounded-br-md bg-bubble-out text-bubble-out-foreground"
              : "rounded-bl-md bg-bubble-in text-bubble-in-foreground border border-border",
          )}
        >
          {showSender && !mine && (
            <p className="mb-0.5 text-[11px] font-semibold text-primary">{message.senderName}</p>
          )}
          {message.forwarded && <p className="mb-0.5 text-[10px] italic opacity-70">Diteruskan</p>}
          {replyTo && (
            <div className={cn("mb-1 rounded-lg border-l-2 px-2 py-1 text-[11px]", mine ? "border-white/60 bg-white/15" : "border-primary bg-muted")}>
              <span className="font-medium">{replyTo.senderName}</span>
              <p className="line-clamp-2 opacity-80">{replyTo.text}</p>
            </div>
          )}
          {message.deleted ? (
            <p className="italic opacity-70">Pesan ini dihapus</p>
          ) : message.kind === "document" ? (
            <div className="flex items-center gap-2">
              <FileText className="size-5 shrink-0" />
              <span className="break-all">{message.attachmentName ?? message.text}</span>
            </div>
          ) : message.kind === "image" ? (
            <div className="space-y-1">
              {message.mediaDataUrl ? (
                <img
                  src={message.mediaDataUrl}
                  alt={message.text || "Foto terkirim"}
                  className="max-h-56 w-52 max-w-full rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-28 w-44 items-center justify-center rounded-xl bg-black/15">
                  <ImageIcon className="size-7 opacity-70" />
                </div>
              )}
              {message.text && <span className="block w-52 max-w-full break-words">{message.text}</span>}
              {message.location && (
                <div className="w-52 max-w-full">
                  <LocationCard location={message.location} compact />
                </div>
              )}
            </div>
          ) : message.kind === "voice" ? (
            <div className="flex w-44 items-center gap-2">
              <Mic className="size-4 shrink-0" />
              <div className="h-1.5 flex-1 rounded-full bg-current/25">
                <div className="h-full w-1/3 rounded-full bg-current/70" />
              </div>
              <span className="text-[11px]">0:{String(message.durationSec ?? 12).padStart(2, "0")}</span>
            </div>
          ) : message.kind === "poll" ? (
            <div className="w-52 space-y-2">
              <p className="font-medium">{message.text}</p>
              {message.pollOptions?.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => onAction("vote", message, o.label)}
                  className={cn(
                    "block w-full rounded-lg px-2 py-1.5 text-left text-xs",
                    mine ? "bg-white/15 hover:bg-white/25" : "bg-muted hover:bg-muted/70",
                  )}
                >
                  <span className="flex justify-between">
                    <span>{o.label}</span>
                    <span className="font-semibold">{o.votes}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : message.kind === "ledger" ? (
            <div className="flex w-52 items-center gap-2">
              <Wallet className="size-5 shrink-0" />
              <span>{message.text}</span>
            </div>
          ) : (
            <p className="break-words whitespace-pre-wrap">{message.text}</p>
          )}
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", mine ? "opacity-80" : "text-muted-foreground")}>
            {message.starred && <Star className="size-3 fill-current" />}
            {message.pinned && <Pin className="size-3" />}
            {message.edited && <span>diedit</span>}
            <span>{jam(message.at)}</span>
            {mine &&
              (message.status === "read" ? (
                <CheckCheck className="size-3.5 text-sky-200" />
              ) : message.status === "delivered" ? (
                <CheckCheck className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              ))}
          </div>
        </div>
        {message.reactions.length > 0 && (
          <div className="-mt-1.5 flex gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs shadow-sm">
            {message.reactions.map((r, i) => (
              <span key={i}>{r.emoji}</span>
            ))}
          </div>
        )}
      </div>
      {!message.deleted && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 self-center opacity-60" aria-label="Opsi pesan">
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
            <DropdownMenuItem onClick={() => onAction("forward", message)}>
              <Share className="size-4" /> Teruskan
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("star", message)}>
              <Star className="size-4" /> {message.starred ? "Hapus bintang" : "Beri bintang"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("pin", message)}>
              <Pin className="size-4" /> {message.pinned ? "Lepas sematan" : "Sematkan"}
            </DropdownMenuItem>
            {mine && (
              <DropdownMenuItem onClick={() => onAction("edit", message)}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onAction("delete", message)}>
              <Trash2 className="size-4" /> Hapus
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onAttach,
  onVoice,
  onNewLedger,
  editing,
  onCancelEdit,
  replyPreview,
  onCancelReply,
  quickReplies,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onAttach: (kind: "image" | "document" | "camera") => void;
  onVoice: () => void;
  onNewLedger: () => void;
  editing?: boolean | undefined;
  onCancelEdit?: () => void | undefined;
  replyPreview?: Message | undefined;
  onCancelReply?: () => void | undefined;
  quickReplies?: { shortcut: string | undefined; text: string }[];
}) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const matches = value.startsWith("/")
    ? (quickReplies ?? []).filter((q) => (q.shortcut ?? "").startsWith(value.trim().toLowerCase()))
    : [];

  return (
    <div className="sticky bottom-0 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {matches.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-b border-border">
          {matches.map((q) => (
            <button
              key={q.shortcut}
              type="button"
              className="block w-full px-4 py-2 text-left hover:bg-muted"
              onClick={() => onChange(q.text)}
            >
              <span className="text-xs font-semibold text-primary">{q.shortcut}</span>
              <span className="block truncate text-xs text-muted-foreground">{q.text}</span>
            </button>
          ))}
        </div>
      )}
      {replyPreview && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
          <CornerUpLeft className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-primary">{replyPreview.senderName}</p>
            <p className="truncate text-xs text-muted-foreground">{replyPreview.text}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancelReply}>
            Batal
          </Button>
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 border-b border-border bg-warning/15 px-3 py-2 text-xs">
          <Pencil className="size-4" /> Mengedit pesan
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onCancelEdit}>
            Batal
          </Button>
        </div>
      )}
      <div className="flex items-end gap-1.5 px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label="Lampiran">
              <Plus className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onAttach("image")}>
              <ImageIcon className="size-4" /> Foto & galeri
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAttach("document")}>
              <Paperclip className="size-4" /> Dokumen
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onNewLedger}>
              <Wallet className="size-4" /> Catatan utang bersama
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex flex-1 items-end rounded-2xl border border-input bg-background px-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Emoji">
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
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Tulis pesan…"
            className="max-h-28 min-h-9 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Kamera" onClick={() => onAttach("camera")}>
            <Camera className="size-5" />
          </Button>
        </div>
        {value.trim() ? (
          <Button size="icon" className="size-10 shrink-0 rounded-full" aria-label="Kirim" onClick={onSend}>
            <Send className="size-4.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant={recording ? "destructive" : "default"}
            className="size-10 shrink-0 rounded-full"
            aria-label="Rekam pesan suara"
            onClick={() => {
              if (recording) {
                setRecording(false);
                onVoice();
              } else {
                setRecording(true);
                toast.info("Merekam pesan suara (simulasi)… tekan lagi untuk kirim");
              }
            }}
          >
            <Mic className="size-4.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
