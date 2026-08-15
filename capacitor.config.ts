import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Konfigurasi Capacitor MCM.
 *
 * URL produksi dibaca dari environment (`MCM_APP_URL`). Default
 * `https://mcmchat.lovable.app` selama domain kustom belum Live.
 */
const config: CapacitorConfig = {
  appId: "com.mcm.privateconnect",
  appName: "MCM",
  webDir: "capacitor/www",
  server: {
    url: process.env["MCM_APP_URL"] ?? "https://mcmchat.lovable.app",
    cleartext: false,
  },
  android: { backgroundColor: "#0f1b2a" },
};

export default config;
