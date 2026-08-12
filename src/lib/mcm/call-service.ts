/**
 * Adapter panggilan MCM.
 *
 * MVP ini memakai SimulatedCallAdapter: seluruh media & sinyal hanya simulasi
 * lokal di perangkat. Untuk produksi, ganti implementasi dengan adapter WebRTC
 * (butuh server signalling + STUN/TURN) atau LiveKit tanpa mengubah UI.
 */
export type CallKind = "audio" | "video";

export interface CallSession {
  id: string;
  peerId: string;
  kind: CallKind;
  startedAt: number;
}

export interface CallAdapter {
  readonly name: string;
  readonly isSimulated: boolean;
  start(peerId: string, kind: CallKind): Promise<CallSession>;
  setMuted(session: CallSession, muted: boolean): Promise<void>;
  setCamera(session: CallSession, on: boolean): Promise<void>;
  end(session: CallSession): Promise<{ durationSec: number }>;
}

export class SimulatedCallAdapter implements CallAdapter {
  readonly name = "simulated";
  readonly isSimulated = true;

  async start(peerId: string, kind: CallKind): Promise<CallSession> {
    return { id: `call-${Date.now()}`, peerId, kind, startedAt: Date.now() };
  }
  async setMuted() {}
  async setCamera() {}
  async end(session: CallSession) {
    return { durationSec: Math.round((Date.now() - session.startedAt) / 1000) };
  }
}

export const callAdapter: CallAdapter = new SimulatedCallAdapter();
