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
  isBusiness?: boolean;
  online?: boolean;
  lastSeen: string;
  note?: string;
  requestMessage?: string;
}

export type MessageKind = "text" | "image" | "document" | "voice" | "poll" | "system" | "ledger" | "order";

export interface Reaction {
  emoji: string;
  by: string;
}

export interface PollOption {
  label: string;
  votes: number;
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
  replyToId?: ID;
  edited?: boolean;
  deleted?: boolean;
  starred?: boolean;
  pinned?: boolean;
  forwarded?: boolean;
  attachmentName?: string;
  durationSec?: number;
  pollOptions?: PollOption[];
  refId?: ID;
}

export interface Chat {
  id: ID;
  type: "personal" | "group";
  name: string;
  avatarColor: string;
  initials: string;
  contactId?: ID;
  memberIds: ID[];
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  unread: number;
  typing?: boolean;
  disappearingHours: number;
  onlyAdminsCanPost?: boolean;
  isBusiness?: boolean;
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
  | "menunggu"
  | "aktif"
  | "sebagian"
  | "lunas"
  | "ditolak"
  | "disengketakan"
  | "dibatalkan";

export interface LedgerPayment {
  id: ID;
  amount: number;
  at: string;
  method: string;
  proofName?: string;
  note?: string;
}

export interface LedgerEvent {
  id: ID;
  at: string;
  actor: string;
  label: string;
  detail?: string;
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
  attachmentName?: string;
  reminder: boolean;
  createdFromChatId?: ID;
  payments: LedgerPayment[];
  timeline: LedgerEvent[];
}

export interface ProductVariant {
  name: string;
  price: number;
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
}
