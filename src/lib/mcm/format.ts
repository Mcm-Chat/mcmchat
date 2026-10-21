let rupiahFormatter: Intl.NumberFormat | undefined;

export const rupiah = (value: number) => {
  rupiahFormatter ??= new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  return rupiahFormatter.format(Math.round(value));
};

export const rupiahShort = (value: number) => {
  if (Math.abs(value) >= 1_000_000)
    return `Rp ${(value / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (Math.abs(value) >= 1_000) return `Rp ${Math.round(value / 1_000)} rb`;
  return rupiah(value);
};

const TZ = "Asia/Jakarta";

/** Reuse locale/time-zone setup across chat rows, but only initialize formats in use. */
function dateFormatter(options: Intl.DateTimeFormatOptions) {
  let formatter: Intl.DateTimeFormat | undefined;
  return (iso: string) => {
    const date = new Date(iso);
    // Date#toLocale*String returns this for bad input; Intl#format would throw.
    if (Number.isNaN(date.getTime())) return "Invalid Date";
    formatter ??= new Intl.DateTimeFormat("id-ID", { ...options, timeZone: TZ });
    return formatter.format(date);
  };
}

export const jam = dateFormatter({ hour: "2-digit", minute: "2-digit" });

export const tanggal = dateFormatter({ day: "numeric", month: "short", year: "numeric" });

export const tanggalPanjang = dateFormatter({
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const tanggalInput = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function waktuRelatif(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.round(h / 24);
  if (d === 1) return "kemarin";
  if (d < 30) return `${d} hari lalu`;
  return tanggal(iso);
}

export function labelHari(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today.getTime() - 86400000);
  if (sameDay(d, today)) return "Hari ini";
  if (sameDay(d, yesterday)) return "Kemarin";
  return tanggalPanjang(iso);
}

export function sisaHari(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function durasi(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
