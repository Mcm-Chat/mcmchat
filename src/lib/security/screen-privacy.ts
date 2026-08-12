/**
 * Kapabilitas & state proteksi layar MCM.
 *
 * Kebenaran penting: JAVASCRIPT TIDAK BISA memblokir screenshot OS.
 * Pemblokiran nyata hanya berasal dari `FLAG_SECURE` di wadah Android (APK).
 * Modul ini hanya (a) memetakan kapabilitas yang benar-benar ada, dan
 * (b) mengatur privacy curtain saat aplikasi kehilangan fokus/masuk background.
 */

export type ScreenSecurityPlatform = "android-apk" | "web";

export type ScreenSecurityStatus = {
  platform: ScreenSecurityPlatform;
  /** True hanya bila wadah native menandai FLAG_SECURE aktif. */
  flagSecure: boolean;
  /** True bila snapshot Recent Apps dinonaktifkan oleh wadah native. */
  recentsProtected: boolean;
  label: string;
  detail: string;
};

type NativeBridge = {
  screenSecurity?: { flagSecure?: boolean; recentsScreenshotDisabled?: boolean };
};

/** Baca kapabilitas dari penanda yang ditulis wadah native ke WebView. */
export function readScreenSecurity(win?: {
  Capacitor?: { isNativePlatform?: () => boolean };
  MCMNative?: NativeBridge;
}): ScreenSecurityStatus {
  const native = Boolean(win?.Capacitor?.isNativePlatform?.());
  const bridge = win?.MCMNative?.screenSecurity;
  const flagSecure = native && bridge?.flagSecure === true;
  const recentsProtected = native && bridge?.recentsScreenshotDisabled === true;
  if (flagSecure) {
    return {
      platform: "android-apk",
      flagSecure: true,
      recentsProtected,
      label: "Perlindungan layar aktif — screenshot dan perekaman diblokir",
      detail: recentsProtected
        ? "FLAG_SECURE aktif di seluruh layar dan pratinjau Recent Apps dimatikan."
        : "FLAG_SECURE aktif di seluruh layar aplikasi.",
    };
  }
  return {
    platform: "web",
    flagSecure: false,
    recentsProtected: false,
    label: "Perlindungan latar aktif — pemblokiran screenshot penuh tersedia di APK Android",
    detail:
      "Browser dan PWA tidak dapat memblokir screenshot sistem operasi. MCM hanya menutup layar (privacy curtain) saat aplikasi kehilangan fokus dan memblokir pencetakan konten.",
  };
}

export type CurtainEvent =
  | { type: "hidden" }
  | { type: "blur" }
  | { type: "pagehide" }
  | { type: "focus" }
  | { type: "visible" }
  | { type: "frame-ready" };

export type CurtainState = { covered: boolean; pendingReveal: boolean };

export const INITIAL_CURTAIN: CurtainState = { covered: false, pendingReveal: false };

/**
 * Tirai dipasang segera saat kehilangan fokus, dan hanya dilepas setelah
 * frame pertama siap agar tidak ada kilatan konten saat kembali aktif.
 */
export function curtainReducer(state: CurtainState, event: CurtainEvent): CurtainState {
  switch (event.type) {
    case "hidden":
    case "blur":
    case "pagehide":
      return { covered: true, pendingReveal: false };
    case "focus":
    case "visible":
      return state.covered ? { covered: true, pendingReveal: true } : state;
    case "frame-ready":
      return state.pendingReveal ? INITIAL_CURTAIN : state;
    default:
      return state;
  }
}
