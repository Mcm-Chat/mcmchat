export type PremiumPlan = {
  id: "monthly" | "yearly";
  name: string;
  price: number;
  period: string;
  note: string;
  perks: string[];
  highlight?: boolean;
};

export const PREMIUM_PLANS: PremiumPlan[] = [
  {
    id: "monthly",
    name: "Premium Bulanan",
    price: 29000,
    period: "/bulan",
    note: "Berhenti kapan saja",
    perks: ["Semua preset efek suara", "Kontrol nada & formant detail", "Dukungan prioritas"],
  },
  {
    id: "yearly",
    name: "Premium Tahunan",
    price: 290000,
    period: "/tahun",
    note: "Hemat 2 bulan",
    perks: [
      "Semua manfaat bulanan",
      "Preset kustom tersimpan",
      "Prioritas fitur baru lebih awal",
    ],
    highlight: true,
  },
];

export function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

const KEY = "mcm.premium.simulation";

export type PremiumSimulation = {
  planId: PremiumPlan["id"];
  method: string;
  at: string;
};

/** Hasil simulasi hanya disimpan lokal dan TIDAK memberi akses premium nyata. */
export function readSimulation(): PremiumSimulation | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PremiumSimulation) : null;
  } catch {
    return null;
  }
}

export function saveSimulation(sim: PremiumSimulation) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sim));
  } catch {
    /* storage penuh atau diblokir — abaikan */
  }
}

export function clearSimulation() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* abaikan */
  }
}
