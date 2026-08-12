export type CallProvider = {
  isConfigured(): boolean;
  start(conversationId: string, kind: "audio" | "video", participantIds: string[]): Promise<never>;
};

/**
 * Tidak ada kredensial penyedia panggilan real-time (WebRTC/SFU/TURN) yang
 * dikonfigurasi di lingkungan ini. Adapter ini jujur menolak permintaan mulai
 * panggilan alih-alih mensimulasikan koneksi palsu.
 */
export const unconfiguredProvider: CallProvider = {
  isConfigured: () => false,
  start: async () => {
    throw new Error("Panggilan belum dikonfigurasi. Hubungi admin untuk mengaktifkan penyedia panggilan.");
  },
};

export function getCallProvider(): CallProvider {
  return unconfiguredProvider;
}

export function isCallingConfigured(): boolean {
  return getCallProvider().isConfigured();
}
