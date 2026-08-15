/**
 * Pesan kegagalan panggilan yang jelas dan bisa ditindaklanjuti.
 *
 * Semua alasan mentah (pesan RPC server, error media browser, kegagalan
 * penyedia) dipetakan ke satu kalimat penyebab + satu kalimat langkah
 * berikutnya, dalam Bahasa Indonesia, tanpa istilah teknis.
 */

export type CallFailureOutcome = "retry" | "ended" | "permission" | "device" | "provider";

export type CallFailureMessage = {
  /** Apa yang terjadi (satu kalimat, tanpa jargon). */
  message: string;
  /** Apa yang harus dilakukan pengguna berikutnya. */
  action: string;
  /** Menentukan apakah layar boleh menawarkan "Coba sambungkan lagi". */
  outcome: CallFailureOutcome;
};

function norm(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  return text.toLowerCase();
}

const join = (m: CallFailureMessage) => `${m.message} ${m.action}`;

/** Kegagalan saat menekan tombol "Jawab". */
export function describeAnswerFailure(raw: unknown): CallFailureMessage {
  const r = norm(raw);
  if (/sudah berakhir|tidak ditemukan|sudah keluar|missed|declined|tak terjawab/.test(r))
    return {
      message: "Panggilan sudah berakhir sebelum sempat diangkat.",
      action: "Tutup layar ini lalu telepon balik dari riwayat panggilan.",
      outcome: "ended",
    };
  if (/bukan peserta|tidak memiliki akses|permission denied|row-level security/.test(r))
    return {
      message: "Panggilan ini bukan untuk akun yang sedang masuk.",
      action: "Pastikan Anda masuk dengan akun yang benar, lalu minta penelepon mengulang.",
      outcome: "ended",
    };
  if (/pemanggil tidak bisa menjawab/.test(r))
    return {
      message: "Panggilan ini Anda sendiri yang memulai, jadi tidak bisa dijawab di sini.",
      action: "Tunggu lawan bicara mengangkat atau akhiri panggilan.",
      outcome: "ended",
    };
  if (/koneksi|network|failed to fetch|timeout|jaringan/.test(r))
    return {
      message: "Jawaban tidak sampai ke server karena koneksi terputus.",
      action: "Periksa sinyal atau Wi-Fi, lalu tekan Jawab sekali lagi.",
      outcome: "retry",
    };
  return {
    message: "Panggilan gagal diangkat.",
    action: "Tekan Jawab sekali lagi; bila tetap gagal, telepon balik dari riwayat panggilan.",
    outcome: "retry",
  };
}

/** Kegagalan saat menyambungkan media (langsung putus setelah diangkat). */
export function describeConnectFailure(raw: unknown): CallFailureMessage {
  const r = norm(raw);
  if (/notallowed|izin|permission|denied/.test(r))
    return {
      message: "Panggilan putus karena akses mikrofon/kamera ditolak.",
      action: "Izinkan mikrofon dan kamera di pengaturan aplikasi, lalu coba sambungkan lagi.",
      outcome: "permission",
    };
  if (/notfound|notreadable|overconstrained|mikrofon|kamera|perangkat|sedang dipakai/.test(r))
    return {
      message: "Mikrofon atau kamera tidak bisa dipakai (mungkin dipakai aplikasi lain).",
      action: "Tutup aplikasi lain atau pilih perangkat lain lewat Ganti perangkat.",
      outcome: "device",
    };
  if (/token|kredensial|penyedia|livekit|unauthorized|401|403/.test(r))
    return {
      message: "Layanan panggilan menolak sambungan ini.",
      action:
        "Coba sambungkan lagi; bila tetap gagal, hubungi pemilik aplikasi untuk memeriksa layanan panggilan.",
      outcome: "provider",
    };
  if (/ice|signal|sinyal|jaringan|network|koneksi|timeout|terputus|disconnect/.test(r))
    return {
      message: "Panggilan langsung putus karena jaringan tidak stabil.",
      action: "Pindah ke sinyal atau Wi-Fi yang lebih kuat, lalu coba sambungkan lagi.",
      outcome: "retry",
    };
  if (/sudah berakhir|tidak tersedia|tidak ditemukan/.test(r))
    return {
      message: "Panggilan sudah ditutup di sisi lawan bicara.",
      action: "Tutup layar ini lalu telepon balik bila masih perlu.",
      outcome: "ended",
    };
  return {
    message: "Suara dan video gagal tersambung.",
    action: "Coba sambungkan lagi atau ganti perangkat mikrofon/kamera.",
    outcome: "retry",
  };
}

/** Satu baris siap tampil untuk banner/aria-live. */
export function answerFailureText(raw: unknown): string {
  return join(describeAnswerFailure(raw));
}

export function connectFailureText(raw: unknown): string {
  return join(describeConnectFailure(raw));
}

/** Aksi langsung yang paling relevan untuk sebuah kegagalan. */
export type CallFailureAction = "retry" | "devices" | "provider" | "permission" | "back";

export type CallFailureSummary = {
  /** Ringkasan sangat singkat, mis. "Izin mikrofon ditolak". */
  label: string;
  /** Aksi utama yang harus ditonjolkan di layar pemulihan. */
  primary: CallFailureAction;
};

/**
 * Ringkas alasan mentah menjadi satu frasa pendek + aksi langsung.
 * Dipakai di layar pemulihan agar penyebab terbaca sekilas.
 */
export function summarizeCallFailure(raw: unknown, unconfigured?: boolean): CallFailureSummary {
  if (unconfigured) return { label: "Layanan panggilan belum siap", primary: "provider" };
  const r = norm(raw);
  if (/notallowed|izin.*(tolak|ditolak)|permission|denied/.test(r)) {
    const cam = /kamera|camera|video/.test(r);
    return { label: cam ? "Izin kamera ditolak" : "Izin mikrofon ditolak", primary: "permission" };
  }
  if (/sedang dipakai|notreadable|dipakai aplikasi lain/.test(r))
    return { label: "Mikrofon dipakai aplikasi lain", primary: "devices" };
  if (/notfound|overconstrained|tidak terbaca|perangkat|mikrofon|kamera|device/.test(r))
    return { label: "Perangkat audio/video tidak terbaca", primary: "devices" };
  if (/timeout|waktu habis|kehabisan waktu|deadline/.test(r))
    return { label: "Waktu join habis", primary: "retry" };
  if (/token|kredensial|livekit|unauthorized|401|403|penyedia/.test(r))
    return { label: "Layanan panggilan menolak sambungan", primary: "provider" };
  if (/ice|signal|sinyal|jaringan|network|koneksi|terputus|disconnect|offline/.test(r))
    return { label: "Koneksi jaringan terputus", primary: "retry" };
  if (/sudah berakhir|tidak tersedia|tidak ditemukan|missed|declined/.test(r))
    return { label: "Panggilan sudah berakhir", primary: "back" };
  return { label: "Panggilan gagal tersambung", primary: "retry" };
}
