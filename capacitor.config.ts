import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Konfigurasi Capacitor MCM.
 *
 * URL produksi dibaca dari environment (`MCM_APP_URL`). Default
 * `https://mcmchat.id`; selama domain itu belum Live, set
 * `MCM_APP_URL=https://mcmchat.lovable.app` saat build.
 */
const config: CapacitorConfig = {
  appId: "com.mcm.privateconnect",
  appName: "MCM",
  webDir: "capacitor/www",
  server: {
    url: process.env["MCM_APP_URL"] ?? "https://mcmchat.id",
    cleartext: false,
  },
  android: { backgroundColor: "#0f1b2a" },
};

export default config;
