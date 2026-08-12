import type { MCMState } from "./types";

const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;
const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString();
const isoFuture = (offsetMs: number) => new Date(now + offsetMs).toISOString();

export const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePin(): string {
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += PIN_ALPHABET[Math.floor(Math.random() * PIN_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function createDemoState(): MCMState {
  return {
    version: 1,
    authed: false,
    onboarded: false,
    profile: {
      id: "me",
      name: "Andi Pratama",
      pin: "M7K9-X2PF",
      bio: "Founder Kopi Nusa • Bandung",
      avatarColor: "from-emerald-500 to-teal-600",
      initials: "AP",
      phoneMasked: "+62 812•••••342",
      lastSeen: iso(2 * min),
    },
    contacts: [
      {
        id: "c-rina",
        name: "Rina Wulandari",
        pin: "R4TP-9WQZ",
        bio: "Desainer grafis lepas",
        avatarColor: "from-rose-500 to-pink-600",
        initials: "RW",
        status: "contact",
        online: true,
        lastSeen: iso(1 * min),
      },
      {
        id: "c-budi",
        name: "Budi Santoso",
        pin: "B8HM-3XKD",
        bio: "Supplier biji kopi Garut",
        avatarColor: "from-amber-500 to-orange-600",
        initials: "BS",
        status: "contact",
        lastSeen: iso(3 * hour),
      },
      {
        id: "c-sari",
        name: "Sari Melati",
        pin: "S5QW-7ZNB",
        bio: "Admin keuangan",
        avatarColor: "from-violet-500 to-purple-600",
        initials: "SM",
        status: "contact",
        online: true,
        lastSeen: iso(4 * min),
      },
      {
        id: "c-toko",
        name: "Toko Maju Jaya",
        pin: "T3JD-6KMP",
        bio: "Grosir kemasan & peralatan kedai",
        avatarColor: "from-sky-500 to-blue-600",
        initials: "TM",
        status: "contact",
        isBusiness: true,
        lastSeen: iso(40 * min),
      },
      {
        id: "c-dewi",
        name: "Dewi Anggraini",
        pin: "D9FR-2VTC",
        bio: "Barista • Kopi Nusa Dago",
        avatarColor: "from-fuchsia-500 to-rose-600",
        initials: "DA",
        status: "incoming",
        lastSeen: iso(20 * min),
        requestMessage: "Halo Kak Andi, ini Dewi barista shift pagi.",
      },
      {
        id: "c-hendra",
        name: "Hendra Kusuma",
        pin: "H2LN-8YQS",
        bio: "Kurir mitra",
        avatarColor: "from-lime-500 to-green-600",
        initials: "HK",
        status: "outgoing",
        lastSeen: iso(2 * day),
        requestMessage: "Pak Hendra, saya Andi dari Kopi Nusa.",
      },
      {
        id: "c-anon",
        name: "Pengguna Q7WD-4KLM",
        pin: "Q7WD-4KLM",
        bio: "Profil disembunyikan",
        avatarColor: "from-slate-500 to-slate-700",
        initials: "QK",
        status: "blocked",
        lastSeen: iso(9 * day),
      },
    ],
    chats: [
      {
        id: "ch-rina",
        type: "personal",
        name: "Rina Wulandari",
        avatarColor: "from-rose-500 to-pink-600",
        initials: "RW",
        contactId: "c-rina",
        memberIds: ["me", "c-rina"],
        pinned: true,
        archived: false,
        muted: false,
        unread: 2,
        typing: true,
        disappearingHours: 0,
      },
      {
        id: "ch-tim",
        type: "group",
        name: "Tim MCM",
        avatarColor: "from-emerald-500 to-teal-700",
        initials: "TM",
        memberIds: ["me", "c-rina", "c-budi", "c-sari"],
        pinned: true,
        archived: false,
        muted: false,
        unread: 5,
        disappearingHours: 24,
      },
      {
        id: "ch-budi",
        type: "personal",
        name: "Budi Santoso",
        avatarColor: "from-amber-500 to-orange-600",
        initials: "BS",
        contactId: "c-budi",
        memberIds: ["me", "c-budi"],
        pinned: false,
        archived: false,
        muted: false,
        unread: 0,
        disappearingHours: 0,
      },
      {
        id: "ch-sari",
        type: "personal",
        name: "Sari Melati",
        avatarColor: "from-violet-500 to-purple-600",
        initials: "SM",
        contactId: "c-sari",
        memberIds: ["me", "c-sari"],
        pinned: false,
        archived: false,
        muted: true,
        unread: 0,
        disappearingHours: 0,
      },
      {
        id: "ch-toko",
        type: "personal",
        name: "Toko Maju Jaya",
        avatarColor: "from-sky-500 to-blue-600",
        initials: "TM",
        contactId: "c-toko",
        memberIds: ["me", "c-toko"],
        pinned: false,
        archived: false,
        muted: false,
        unread: 1,
        isBusiness: true,
        disappearingHours: 0,
      },
    ],
    messages: [
      msg("ch-rina", "c-rina", "Rina Wulandari", "Pagi Andi! Desain menu edisi Ramadan sudah aku kirim ke email ya.", 3 * hour, "read"),
      msg("ch-rina", "me", "Andi Pratama", "Siap Rina, aku cek sekarang. Makasih banyak!", 2.8 * hour, "read"),
      { ...msg("ch-rina", "c-rina", "Rina Wulandari", "menu-ramadan-final.pdf", 2 * hour, "read"), kind: "document", attachmentName: "menu-ramadan-final.pdf" },
      msg("ch-rina", "me", "Andi Pratama", "Filenya kebuka. Warnanya pas banget sama brand kita 👌", 1.5 * hour, "read"),
      { ...msg("ch-rina", "c-rina", "Rina Wulandari", "Pesan suara", 25 * min, "delivered"), kind: "voice", durationSec: 14 },
      msg("ch-rina", "c-rina", "Rina Wulandari", "Oh iya, invoice desain bulan ini boleh dibayar minggu depan ya?", 12 * min, "delivered"),

      { ...msg("ch-tim", "c-sari", "Sari Melati", "Sari menambahkan Budi Santoso ke grup", 5 * day, "read"), kind: "system" },
      msg("ch-tim", "c-sari", "Sari Melati", "Rekap penjualan minggu ini sudah aku update di sheet ya tim.", 6 * hour, "read"),
      msg("ch-tim", "c-budi", "Budi Santoso", "Stok biji Arabika Garut aman sampai akhir bulan.", 5 * hour, "read"),
      msg("ch-tim", "me", "Andi Pratama", "Mantap. Jangan lupa besok kita meeting jam 10 di kedai Dago.", 4 * hour, "read"),
      {
        ...msg("ch-tim", "c-rina", "Rina Wulandari", "Jam berapa enaknya meeting mingguan?", 3 * hour, "read"),
        kind: "poll",
        pollOptions: [
          { label: "Senin 10.00 WIB", votes: 3 },
          { label: "Selasa 14.00 WIB", votes: 1 },
          { label: "Rabu 09.00 WIB", votes: 2 },
        ],
      },
      msg("ch-tim", "c-sari", "Sari Melati", "Aku pilih Senin pagi biar sekalian stok opname.", 2 * hour, "delivered"),

      msg("ch-budi", "me", "Andi Pratama", "Pak Budi, minta kirim 20kg Arabika Garut untuk minggu depan.", 2 * day, "read"),
      msg("ch-budi", "c-budi", "Budi Santoso", "Baik Pak Andi, saya siapkan. Totalnya Rp 3.400.000.", 2 * day - 20 * min, "read"),
      msg("ch-budi", "me", "Andi Pratama", "Oke, DP 1 juta dulu ya sisanya saat barang sampai.", 2 * day - 30 * min, "read"),

      msg("ch-sari", "c-sari", "Sari Melati", "Kak, laporan kas kecil bulan ini sudah aku rapikan.", 8 * hour, "read"),
      msg("ch-sari", "me", "Andi Pratama", "Makasih Sari, nanti aku review malam ini.", 7 * hour, "read"),

      msg("ch-toko", "me", "Andi Pratama", "Halo, gelas kertas 8oz ready berapa dus?", 50 * min, "read"),
      msg("ch-toko", "c-toko", "Toko Maju Jaya", "Halo Kak Andi! Ready 12 dus. Harga Rp 185.000 per dus isi 500 pcs.", 40 * min, "delivered"),
    ],
    calls: [
      { id: "cl-1", contactId: "c-rina", contactName: "Rina Wulandari", kind: "video", direction: "in", missed: false, at: iso(2 * hour), durationSec: 754 },
      { id: "cl-2", contactId: "c-budi", contactName: "Budi Santoso", kind: "audio", direction: "out", missed: false, at: iso(1 * day), durationSec: 321 },
      { id: "cl-3", contactId: "c-sari", contactName: "Sari Melati", kind: "audio", direction: "in", missed: true, at: iso(1 * day + 3 * hour), durationSec: 0 },
      { id: "cl-4", contactId: "c-toko", contactName: "Toko Maju Jaya", kind: "audio", direction: "out", missed: true, at: iso(3 * day), durationSec: 0 },
      { id: "cl-5", contactId: "c-rina", contactName: "Rina Wulandari", kind: "audio", direction: "out", missed: false, at: iso(4 * day), durationSec: 128 },
    ],
    ledgers: [
      {
        id: "lg-1",
        type: "piutang",
        counterpartId: "c-rina",
        counterpartName: "Rina Wulandari",
        amount: 2500000,
        paid: 1000000,
        date: iso(12 * day),
        dueDate: isoFuture(5 * day),
        note: "Talangan biaya cetak menu & banner promo",
        status: "sebagian",
        reminder: true,
        attachmentName: "nota-cetak-menu.jpg",
        payments: [
          { id: "pm-1", amount: 1000000, at: iso(4 * day), method: "Transfer BCA", proofName: "bukti-transfer-1.jpg", note: "Cicilan pertama" },
        ],
        timeline: [
          ev("ev-1", 12 * day, "Andi Pratama", "Catatan dibuat", "Rp 2.500.000 • jatuh tempo 5 hari lagi"),
          ev("ev-2", 11 * day, "Rina Wulandari", "Disetujui", "Kedua pihak menyetujui nominal"),
          ev("ev-3", 4 * day, "Rina Wulandari", "Pembayaran dicatat", "Rp 1.000.000 via Transfer BCA"),
        ],
      },
      {
        id: "lg-2",
        type: "utang",
        counterpartId: "c-budi",
        counterpartName: "Budi Santoso",
        amount: 3400000,
        paid: 1000000,
        date: iso(2 * day),
        dueDate: isoFuture(2 * day),
        note: "Pembelian 20kg biji Arabika Garut",
        status: "aktif",
        reminder: true,
        payments: [{ id: "pm-2", amount: 1000000, at: iso(2 * day), method: "Transfer BRI", note: "DP" }],
        timeline: [
          ev("ev-4", 2 * day, "Andi Pratama", "Catatan dibuat", "Rp 3.400.000"),
          ev("ev-5", 2 * day, "Budi Santoso", "Disetujui"),
          ev("ev-6", 2 * day, "Andi Pratama", "Pembayaran dicatat", "DP Rp 1.000.000"),
        ],
      },
      {
        id: "lg-3",
        type: "piutang",
        counterpartId: "c-sari",
        counterpartName: "Sari Melati",
        amount: 750000,
        paid: 0,
        date: iso(1 * day),
        dueDate: isoFuture(14 * day),
        note: "Kasbon karyawan bulan ini",
        status: "menunggu",
        reminder: false,
        payments: [],
        timeline: [ev("ev-7", 1 * day, "Andi Pratama", "Catatan dibuat", "Menunggu persetujuan Sari Melati")],
      },
      {
        id: "lg-4",
        type: "utang",
        counterpartId: "c-toko",
        counterpartName: "Toko Maju Jaya",
        amount: 1850000,
        paid: 1850000,
        date: iso(30 * day),
        dueDate: iso(10 * day),
        note: "Pembelian gelas kertas & tutup 10 dus",
        status: "lunas",
        reminder: false,
        payments: [{ id: "pm-3", amount: 1850000, at: iso(11 * day), method: "Transfer Mandiri", proofName: "bukti-pelunasan.jpg" }],
        timeline: [
          ev("ev-8", 30 * day, "Toko Maju Jaya", "Catatan dibuat"),
          ev("ev-9", 29 * day, "Andi Pratama", "Disetujui"),
          ev("ev-10", 11 * day, "Andi Pratama", "Pelunasan dicatat", "Rp 1.850.000"),
        ],
      },
    ],
    products: [
      // Produk lama: masih memakai satu foto + satu lokasi (dimigrasikan otomatis).
      {
        ...prod("p-1", "Kopi Susu Nusa", "Minuman", 24000, 10, "KN-001", 120, "Espresso double dengan susu segar dan gula aren cair.", "☕"),
        imageUrl: swatch("#0f766e", "Kopi Susu"),
        locationUrl: "https://www.google.com/maps?q=-6.89147,107.61006",
      },
      {
        ...prod("p-2", "Es Kopi Gula Aren", "Minuman", 26000, 0, "KN-002", 85, "Signature kami, memakai gula aren asli Ciamis.", "🧋"),
        photos: [
          photo("pp-2a", "p-2", swatch("#155e75", "Gudang A"), "https://www.google.com/maps?q=-6.90389,107.61861", "Stok gudang Dago", 0),
          photo("pp-2b", "p-2", swatch("#7c2d12", "Gudang B"), "https://www.google.com/maps?q=-6.93472,107.60694", "Stok gudang Buah Batu", 1),
        ],
      },
      prod("p-2x", "Kopi Kelapa Bakar", "Minuman", 28000, 0, "KN-009", 42, "Kopi dengan santan kelapa bakar dan gula aren.", "🥥"),
      prod("p-3", "Americano Dingin", "Minuman", 22000, 0, "KN-003", 60, "Arabika Garut, seduhan dingin 12 jam.", "🥤"),
      prod("p-4", "Matcha Latte", "Minuman", 30000, 15, "KN-004", 40, "Matcha kelas upacara dengan susu oat pilihan.", "🍵"),
      prod("p-5", "Croissant Butter", "Makanan", 27000, 0, "KN-005", 24, "Dipanggang setiap pagi, 27 lapis mentega Wijsman.", "🥐"),
      prod("p-6", "Roti Bakar Srikaya", "Makanan", 21000, 0, "KN-006", 30, "Roti gandum panggang dengan selai srikaya rumahan.", "🍞"),
      prod("p-7", "Biji Kopi Arabika Garut 250g", "Retail", 95000, 5, "KN-007", 48, "Roast medium, catatan rasa cokelat dan jeruk.", "🫘"),
      prod("p-8", "Tumbler Kopi Nusa 500ml", "Merchandise", 145000, 0, "KN-008", 0, "Stainless steel dinding ganda, tahan panas 6 jam.", "🥤"),
    ],
    orders: [
      order("o-1", "INV/2026/0041", "Rina Wulandari", "R4TP-9WQZ", "baru", 25 * min, [
        { productId: "p-2", name: "Es Kopi Gula Aren", qty: 2, price: 26000 },
        { productId: "p-5", name: "Croissant Butter", qty: 1, price: 27000 },
      ], "Tolong gula setengah ya", "Jl. Riau No. 12, Bandung", 12000),
      order("o-2", "INV/2026/0040", "Dewi Anggraini", "D9FR-2VTC", "diproses", 3 * hour, [
        { productId: "p-7", name: "Biji Kopi Arabika Garut 250g", qty: 3, price: 95000 },
      ], "Untuk oleh-oleh", "Jl. Dago Asri Blok C, Bandung", 15000),
      order("o-3", "INV/2026/0039", "Toko Maju Jaya", "T3JD-6KMP", "dikirim", 1 * day, [
        { productId: "p-1", name: "Kopi Susu Nusa", qty: 10, price: 24000 },
        { productId: "p-6", name: "Roti Bakar Srikaya", qty: 5, price: 21000 },
      ], "Pesanan rapat kantor", "Jl. Soekarno Hatta No. 88, Bandung", 20000),
      order("o-4", "INV/2026/0038", "Budi Santoso", "B8HM-3XKD", "selesai", 4 * day, [
        { productId: "p-8", name: "Tumbler Kopi Nusa 500ml", qty: 2, price: 145000 },
      ], "", "Jl. Cikutra No. 5, Bandung", 0),
    ],
    inbox: [
      { id: "ib-1", customerName: "Rina Wulandari", preview: "Pesanan sudah saya bayar ya kak", label: "Pelanggan Setia", assignee: "Sari Melati", status: "open", at: iso(20 * min), internalNote: "Sering pesan tiap Jumat." },
      { id: "ib-2", customerName: "Dewi Anggraini", preview: "Biji kopinya bisa digiling halus?", label: "Baru", assignee: "Belum ditugaskan", status: "pending", at: iso(2 * hour), internalNote: "" },
      { id: "ib-3", customerName: "Toko Maju Jaya", preview: "Invoice bulan ini tolong dikirim", label: "Grosir", assignee: "Andi Pratama", status: "open", at: iso(5 * hour), internalNote: "Termin pembayaran 14 hari." },
      { id: "ib-4", customerName: "Hendra Kusuma", preview: "Terima kasih, barang sudah sampai", label: "Kurir", assignee: "Sari Melati", status: "closed", at: iso(2 * day), internalNote: "" },
    ],
    business: {
      active: true,
      name: "Kopi Nusa",
      category: "Kafe & Kedai Kopi",
      description: "Kedai kopi spesialti di Bandung dengan biji lokal Garut. Melayani dine-in, take away, dan grosir biji kopi.",
      address: "Jl. Dago Asri No. 21, Bandung, Jawa Barat",
      hours: "Setiap hari 07.00 - 22.00 WIB",
      contact: "Chat MCM (nomor telepon disembunyikan)",
      pin: "KN44-9TPZ",
      logoEmoji: "☕",
      greeting: "Halo! Terima kasih sudah menghubungi Kopi Nusa. Ada yang bisa kami bantu?",
      awayMessage: "Kami sedang di luar jam operasional (07.00-22.00 WIB). Pesan Anda akan dibalas besok pagi.",
      role: "owner",
      quickReplies: [
        { shortcut: "/harga", text: "Daftar harga terbaru bisa dilihat di katalog kami. Kopi Susu Nusa Rp 24.000, Es Kopi Gula Aren Rp 26.000." },
        { shortcut: "/alamat", text: "Kami di Jl. Dago Asri No. 21, Bandung. Patokan seberang minimarket." },
        { shortcut: "/jam", text: "Kami buka setiap hari pukul 07.00 - 22.00 WIB." },
        { shortcut: "/rekening", text: "Pembayaran transfer ke BCA 1234567890 a.n. Kopi Nusa Indonesia." },
        { shortcut: "/katalog", text: "Silakan lihat katalog lengkap kami di menu Katalog aplikasi MCM." },
        { shortcut: "/statuspesanan", text: "Boleh dibantu dengan nomor invoice pesanannya? Contoh: INV/2026/0041." },
      ],
      broadcastOptIn: ["c-rina", "c-budi", "c-sari"],
    },
    settings: {
      theme: "light",
      privacy: { lastSeen: "kontak", online: true, photo: "kontak", readReceipts: true, addToGroup: "kontak", canCall: "kontak" },
      security: {
        appLock: false,
        twoFactor: false,
        devices: [
          { id: "dv-1", name: "Android • Pixel 8", location: "Bandung, Indonesia", at: iso(5 * min), current: true },
          { id: "dv-2", name: "Web • Chrome (Windows)", location: "Bandung, Indonesia", at: iso(2 * day), current: false },
        ],
      },
      notifications: { chat: true, group: true, calls: true, ledger: true, business: true, lockPreview: false, sound: true },
    },
    notifications: [
      { id: "nt-1", title: "Pesan baru dari Rina Wulandari", body: "Oh iya, invoice desain bulan ini...", at: iso(12 * min), read: false, kind: "chat" },
      { id: "nt-2", title: "Pesanan baru INV/2026/0041", body: "Rina Wulandari memesan 3 item", at: iso(25 * min), read: false, kind: "business" },
      { id: "nt-3", title: "Jatuh tempo mendekat", body: "Utang ke Budi Santoso jatuh tempo 2 hari lagi", at: iso(3 * hour), read: true, kind: "ledger" },
      { id: "nt-4", title: "Panggilan tak terjawab", body: "Sari Melati menelepon Anda", at: iso(1 * day + 3 * hour), read: true, kind: "call" },
    ],
    searchAttempts: [],
    deletedMessageIds: [],
  };
}

let seq = 0;
function msg(
  chatId: string,
  senderId: string,
  senderName: string,
  text: string,
  ago: number,
  status: "sent" | "delivered" | "read",
) {
  seq += 1;
  return {
    id: `m-${seq}`,
    chatId,
    senderId,
    senderName,
    kind: "text" as const,
    text,
    at: iso(ago),
    status,
    reactions: [] as { emoji: string; by: string }[],
  };
}

function ev(id: string, ago: number, actor: string, label: string, detail?: string) {
  return { id, at: iso(ago), actor, label, detail };
}

function prod(
  id: string,
  name: string,
  category: string,
  price: number,
  discountPercent: number,
  sku: string,
  stock: number,
  description: string,
  emoji: string,
) {
  return {
    id,
    name,
    category,
    price,
    discountPercent,
    sku,
    stock,
    description,
    active: stock > 0,
    emoji,
    photos: [],
    variants:
      category === "Minuman"
        ? [
            { name: "Reguler", price },
            { name: "Large", price: price + 6000 },
          ]
        : [],
  };
}

function order(
  id: string,
  number: string,
  customerName: string,
  customerPin: string,
  status: "baru" | "diproses" | "dikirim" | "selesai" | "dibatalkan",
  ago: number,
  items: { productId: string; name: string; qty: number; price: number }[],
  note: string,
  address: string,
  shipping: number,
) {
  return { id, number, customerName, customerPin, status, at: iso(ago), items, note, address, shipping };
}

/** Direktori pengguna demo yang bisa ditemukan lewat pencarian PIN. */
export const DEMO_DIRECTORY: { pin: string; name: string; bio: string; initials: string; avatarColor: string }[] = [
  { pin: "R8NA-K4Q7", name: "Rina Safitri", bio: "Desainer grafis • Bandung", initials: "RS", avatarColor: "from-fuchsia-500 to-rose-600" },
  { pin: "G6TX-P2WV", name: "Galih Prasetya", bio: "Supplier biji kopi • Garut", initials: "GP", avatarColor: "from-amber-500 to-orange-600" },
  { pin: "N3KY-Z8HR", name: "Nadia Puspita", bio: "Admin toko online", initials: "NP", avatarColor: "from-teal-500 to-emerald-600" },
];
