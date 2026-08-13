export type ID = string;

export interface Profile {
  id: ID;
  name: string;
  pin: string;
  bio: string;
  avatarColor: string;
  initials: string;
  phoneMasked: string;
  lastSeen: string;
}

export type ContactStatus = "contact" | "incoming" | "outgoing" | "blocked";

export interface Contact {
  id: ID;
  name: string;
  pin: string;
  bio: string;
  avatarColor: string;
  initials: string;
  status: ContactStatus;
  isBusiness?: boolean | undefined;
  online?: boolean | undefined;
  lastSeen: string;
  note?: string | undefined;
  requestMessage?: string | undefined;
}

export type MessageKind =
  "text" | "image" | "document" | "voice" | "poll" | "system" | "ledger" | "order";

export interface Reaction {
  emoji: string;
  by: string;
}

export interface PollOption {
  label: string;
  votes: number;
}

export interface MessageLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  label: string;
  mapsUrl: string;
  capturedAt: string;
  source: "gps" | "manual" | "demo";
}

export interface Message {
  id: ID;
  chatId: ID;
  senderId: ID; // "me" for current user
  senderName: string;
  kind: MessageKind;
  text: string;
  at: string;
  status: "sending" | "sent" | "delivered" | "read";
  reactions: Reaction[];
  replyToId?: ID | undefined;
  edited?: boolean | undefined;
  /** Daftar peserta yang menyembunyikan pesan ini secara lokal ("hapus untuk saya"). */
  hiddenFor?: ID[] | undefined;
  starred?: boolean | undefined;
  pinned?: boolean | undefined;
  forwarded?: boolean | undefined;
  attachmentName?: string | undefined;
  durationSec?: number | undefined;
  pollOptions?: PollOption[] | undefined;
  refId?: ID | undefined;
  mediaDataUrl?: string | undefined;
  location?: MessageLocation | undefined;
}

export interface Chat {
  id: ID;
  type: "personal" | "group";
  name: string;
  avatarColor: string;
  initials: string;
  contactId?: ID | undefined;
  memberIds: ID[];
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  unread: number;
  typing?: boolean | undefined;
  disappearingHours: number;
  onlyAdminsCanPost?: boolean | undefined;
  isBusiness?: boolean | undefined;
}

export interface CallLog {
  id: ID;
  contactId: ID;
  contactName: string;
  kind: "audio" | "video";
  direction: "in" | "out";
  missed: boolean;
  at: string;
  durationSec: number;
}

export type LedgerStatus =
  "menunggu" | "aktif" | "sebagian" | "lunas" | "ditolak" | "disengketakan" | "dibatalkan";

export interface LedgerPayment {
  id: ID;
  amount: number;
  at: string;
  method: string;
  proofName?: string | undefined;
  note?: string | undefined;
}

export interface LedgerEvent {
  id: ID;
  at: string;
  actor: string;
  label: string;
  detail?: string | undefined;
}

export interface LedgerEntry {
  id: ID;
  type: "piutang" | "utang"; // piutang = orang lain berutang ke saya
  counterpartId: ID;
  counterpartName: string;
  amount: number;
  paid: number;
  date: string;
  dueDate: string;
  note: string;
  status: LedgerStatus;
  attachmentName?: string | undefined;
  reminder: boolean;
  createdFromChatId?: ID | undefined;
  payments: LedgerPayment[];
  timeline: LedgerEvent[];
}

export interface ProductVariant {
  name: string;
  price: number;
}

/** Satu foto produk dengan link lokasi miliknya sendiri. */
export interface ProductPhoto {
  id: ID;
  productId: ID;
  imageUrl: string;
  locationUrl: string;
  caption: string;
  sortOrder: number;
  createdAt: string;
}

export interface Product {
  id: ID;
  name: string;
  category: string;
  price: number;
  discountPercent: number;
  sku: string;
  stock: number;
  description: string;
  active: boolean;
  emoji: string;
  variants: ProductVariant[];
  photos: ProductPhoto[];
  /** Field lama (satu foto / satu lokasi) — hanya dibaca saat migrasi. */
  imageUrl?: string | undefined;
  image?: string | undefined;
  locationUrl?: string | undefined;
}

export type OrderStatus = "baru" | "diproses" | "dikirim" | "selesai" | "dibatalkan";

export interface OrderItem {
  productId: ID;
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: ID;
  number: string;
  customerName: string;
  customerPin: string;
  items: OrderItem[];
  status: OrderStatus;
  at: string;
  note: string;
  address: string;
  shipping: number;
}

export type InboxStatus = "open" | "pending" | "closed";

export interface InboxThread {
  id: ID;
  customerName: string;
  preview: string;
  label: string;
  assignee: string;
  status: InboxStatus;
  at: string;
  internalNote: string;
}

export interface Business {
  active: boolean;
  name: string;
  category: string;
  description: string;
  address: string;
  hours: string;
  contact: string;
  pin: string;
  logoEmoji: string;
  greeting: string;
  awayMessage: string;
  role: "owner" | "admin" | "agent" | "kasir" | "viewer";
  quickReplies: { shortcut: string; text: string }[];
  broadcastOptIn: ID[];
}

export interface Settings {
  theme: "light" | "dark";
  privacy: {
    lastSeen: "semua" | "kontak" | "tidak";
    online: boolean;
    photo: "semua" | "kontak" | "tidak";
    readReceipts: boolean;
    addToGroup: "semua" | "kontak";
    canCall: "semua" | "kontak";
  };
  security: {
    appLock: boolean;
    twoFactor: boolean;
    devices: { id: ID; name: string; location: string; at: string; current: boolean }[];
  };
  notifications: {
    chat: boolean;
    group: boolean;
    calls: boolean;
    ledger: boolean;
    business: boolean;
    lockPreview: boolean;
    sound: boolean;
  };
}

export interface AppNotification {
  id: ID;
  title: string;
  body: string;
  at: string;
  read: boolean;
  kind: "chat" | "call" | "ledger" | "business";
}

export interface MCMState {
  version: number;
  authed: boolean;
  onboarded: boolean;
  profile: Profile;
  contacts: Contact[];
  chats: Chat[];
  messages: Message[];
  calls: CallLog[];
  ledgers: LedgerEntry[];
  products: Product[];
  orders: Order[];
  inbox: InboxThread[];
  business: Business;
  settings: Settings;
  notifications: AppNotification[];
  searchAttempts: { at: number }[];
  /** Tombstone internal untuk sinkronisasi hapus-untuk-semua. Tidak pernah dirender. */
  deletedMessageIds?: ID[] | undefined;
}
