/**
 * Pemulihan "modul rute gagal dimuat".
 *
 * Rute berat (Katalog, Panggilan, Ledger, Tugas) diunduh terpisah saat
 * berpindah menu. Setelah versi baru dirilis — atau saat sinyal putus di
 * tengah unduhan — berkas lama yang masih tersimpan di cache/service worker
 * sudah tidak ada di server, sehingga perpindahan menu berakhir di layar
 * error. Kondisi ini tidak bisa diperbaiki oleh tombol "Coba lagi" biasa:
 * satu-satunya jalan adalah memuat ulang aplikasi versi terbaru.
 *
 * Pemuatan ulang dibatasi sekali per sesi tab agar tidak pernah terjadi
 * putaran reload bila penyebabnya ternyata bukan cache basi.
 */
const ONCE_KEY = "mcmChunkReloadAt";
const RELOAD_WINDOW_MS = 60_000;

const PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "failed to load module script",
  "failed to fetch module script",
  "module script load failed",
  "module load failed",
  "networkerror when attempting to fetch resource",
  "unable to preload css",
  "stylesheet preload failed",
  "dynamically imported module",
];

export function isChunkLoadError(error: unknown): boolean {
  const msg =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : "";
  const lower = msg.toLowerCase();
  if (PATTERNS.some((p) => lower.includes(p))) return true;

  // Chromium/WebView tertentu hanya memberi "Load failed"/"Failed to fetch".
  // Klasifikasikan sebagai chunk hanya bila pesan juga menyebut import, modul,
  // script, stylesheet, atau URL aset aplikasi; jangan salah menangkap fetch API.
  const vagueNetworkFailure = /(?:load failed|failed to fetch|networkerror)/.test(lower);
  const assetContext = /(?:import|module|script|stylesheet|\/assets\/|\.m?js(?:\?|$)|\.css(?:\?|$))/.test(
    lower,
  );
  return vagueNetworkFailure && assetContext;
}

/** Memuat ulang halaman sekali; mengembalikan false bila sudah pernah. */
export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(ONCE_KEY) ?? 0);
  } catch {
    /* storage diblokir: tetap lanjut sekali */
  }
  if (last && Date.now() - last < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(ONCE_KEY, String(Date.now()));
  } catch {
    /* abaikan */
  }
  window.location.reload();
  return true;
}

/** Pasang pendengar global; mengembalikan fungsi pembersih. */
export function installChunkRecovery(): () => void {
  if (typeof window === "undefined") return () => {};

  const onPreloadError = (e: Event) => {
    e.preventDefault();
    recoverFromChunkError();
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isChunkLoadError(e.reason)) recoverFromChunkError();
  };
  const onError = (e: ErrorEvent) => {
    if (isChunkLoadError(e.error ?? e.message)) recoverFromChunkError();
  };

  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
  };
}

/** Tahapan pemulihan yang ditampilkan pada tombol "Muat ulang". */
export type RecoveryStage = "idle" | "mencoba" | "mengunduh" | "menampilkan" | "gagal";

/**
 * Error mutasi DOM ("NotFoundError: Failed to execute 'removeChild' on 'Node'…").
 *
 * Terjadi bila pohon DOM yang dipegang React diubah pihak lain — paling sering
 * fitur terjemahan otomatis WebView/Chrome atau ekstensi — sehingga React gagal
 * melepas/menyisipkan node saat commit. Halaman sebenarnya masih sehat: cukup
 * dipasang ulang, tanpa unduh ulang modul atau reload penuh.
 *
 * Sengaja dibatasi pada pesan yang menyebut operasi node, supaya
 * `NotFoundError` dari getUserMedia ("Requested device not found") tidak ikut.
 */
export function isDomMutationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name;
  if (name !== "NotFoundError" && name !== "HierarchyRequestError") return true === false;
  const msg = error.message.toLowerCase();
  return /removechild|insertbefore|appendchild|replacechild|node to be removed|not a child of this node/.test(
    msg,
  );
}

const DOM_HEAL_KEY = "mcmDomHealAt";

/** Izinkan satu pemasangan ulang otomatis per menit agar tidak berputar. */
export function allowDomHeal(): boolean {
  if (typeof window === "undefined") return false;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(DOM_HEAL_KEY) ?? 0);
  } catch {
    /* storage diblokir: tetap coba sekali */
  }
  if (last && Date.now() - last < RELOAD_WINDOW_MS) return false;
  try {
    sessionStorage.setItem(DOM_HEAL_KEY, String(Date.now()));
  } catch {
    /* abaikan */
  }
  return true;
}

type MinimalRouter = {
  preloadRoute: (opts: { to: string }) => Promise<unknown>;
  invalidate: () => Promise<unknown> | unknown;
};

/** Minta service worker aktif memeriksa versi baru tanpa menghapus data/cache lain. */
async function refreshServiceWorkers(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs ?? []).map((r) => r.update()));
  } catch {
    /* abaikan */
  }
}

/**
 * Pemulihan bertahap tanpa reload buta.
 *
 * Dipakai tombol "Muat ulang": membersihkan cache aset basi, mengunduh ulang
 * (prefetch) modul rute yang gagal — misalnya Katalog — lalu menyegarkan data
 * rute sehingga halaman benar-benar tampil. Setiap tahap dilaporkan lewat
 * `onStage` supaya tombol bisa menunjukkan progres. Bila prefetch tetap gagal,
 * barulah aplikasi dimuat ulang penuh sebagai jalan terakhir.
 */
export async function retryRouteLoad(
  router: MinimalRouter,
  target: string,
  onStage: (stage: RecoveryStage) => void,
): Promise<boolean> {
  onStage("mencoba");
  await refreshServiceWorkers();

  onStage("mengunduh");
  try {
    await router.preloadRoute({ to: target });
  } catch {
    onStage("gagal");
    if (typeof window !== "undefined") window.location.reload();
    return false;
  }

  onStage("menampilkan");
  try {
    await router.invalidate();
  } catch {
    /* data akan dimuat ulang oleh rute itu sendiri */
  }
  return true;
}

/**
 * Retry untuk error render/data biasa. Berbeda dari chunk recovery: tidak
 * mengunduh modul ulang, tidak menyentuh Cache Storage, dan tidak reload.
 */
export async function retryRouteRender(
  router: Pick<MinimalRouter, "invalidate">,
  reset: () => void,
  onStage: (stage: RecoveryStage) => void,
): Promise<boolean> {
  onStage("mencoba");
  try {
    reset();
    await router.invalidate();
    onStage("menampilkan");
    return true;
  } catch {
    onStage("gagal");
    return false;
  }
}
