/**
 * Abstraksi penyedia panggilan MCM.
 *
 * UI tidak pernah tahu penyedia mana yang dipakai. Implementasi default adalah
 * LiveKit (WebRTC SFU) dengan token yang diterbitkan server. Bila kredensial
 * belum tersedia, `unconfiguredProvider` dipakai dan UI menampilkan status
 * "Belum terhubung" — tidak ada koneksi palsu yang disimulasikan.
 */
export type CallKind = "audio" | "video";

export type ProviderStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed"
  | "unconfigured";

export type RemoteInfo = {
  identity: string;
  name: string;
  speaking: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
};

export type ProviderState = {
  status: ProviderStatus;
  reason?: string;
  remotes: RemoteInfo[];
};

export type ConnectOptions = {
  url: string;
  token: string;
  kind: CallKind;
  /** Track audio hasil VoicePipeline (sudah diproses) atau mic mentah. */
  audioTrack: MediaStreamTrack | null;
  onState: (s: ProviderState) => void;
};

export interface CallSessionHandle {
  readonly provider: string;
  setMicEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  switchCamera(): Promise<void>;
  /** Ganti track audio keluar tanpa renegosiasi penuh (mis. efek suara on/off). */
  replaceAudioTrack(track: MediaStreamTrack): Promise<void>;
  attachLocalVideo(el: HTMLVideoElement | null): void;
  attachRemoteMedia(el: HTMLVideoElement | null): void;
  disconnect(): Promise<void>;
}

export interface CallProvider {
  readonly name: string;
  isConfigured(): boolean;
  connect(opts: ConnectOptions): Promise<CallSessionHandle>;
}

export const unconfiguredProvider: CallProvider = {
  name: "unconfigured",
  isConfigured: () => false,
  connect: async () => {
    throw new Error("Penyedia panggilan belum terhubung. Hubungi admin untuk mengaktifkan kredensial LiveKit.");
  },
};

/** Implementasi LiveKit; modul SDK dimuat dinamis agar aman untuk SSR. */
export const liveKitProvider: CallProvider = {
  name: "livekit",
  isConfigured: () => true,
  async connect(opts: ConnectOptions): Promise<CallSessionHandle> {
    const lk = await import("livekit-client");
    const { Room, RoomEvent, LocalAudioTrack, Track } = lk;
    const room = new Room({ adaptiveStream: true, dynacast: true });

    let facingUser = true;
    const remotes = (): RemoteInfo[] =>
      Array.from(room.remoteParticipants.values()).map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        speaking: p.isSpeaking,
        micEnabled: p.isMicrophoneEnabled,
        cameraEnabled: p.isCameraEnabled,
      }));
    const emit = (status: ProviderStatus, reason?: string) =>
      opts.onState({ status, remotes: remotes(), ...(reason ? { reason } : {}) });

    room
      .on(RoomEvent.Connected, () => emit("connected"))
      .on(RoomEvent.Reconnecting, () => emit("reconnecting", "Menyambung ulang…"))
      .on(RoomEvent.Reconnected, () => emit("connected"))
      .on(RoomEvent.Disconnected, () => emit("disconnected"))
      .on(RoomEvent.ParticipantConnected, () => emit("connected"))
      .on(RoomEvent.ParticipantDisconnected, () => emit("connected"))
      .on(RoomEvent.ActiveSpeakersChanged, () => emit("connected"))
      .on(RoomEvent.TrackMuted, () => emit("connected"))
      .on(RoomEvent.TrackUnmuted, () => emit("connected"))
      .on(RoomEvent.TrackSubscribed, (track) => {
        // Audio lawan bicara diputar apa adanya; tidak pernah diproses efek.
        if (track.kind === Track.Kind.Audio) track.attach();
        emit("connected");
      });

    emit("connecting");
    await room.connect(opts.url, opts.token);

    if (opts.audioTrack) {
      await room.localParticipant.publishTrack(new LocalAudioTrack(opts.audioTrack), {
        dtx: true,
        red: true,
      });
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }
    if (opts.kind === "video") await room.localParticipant.setCameraEnabled(true);
    emit("connected");

    const firstRemoteVideo = () => {
      for (const p of room.remoteParticipants.values()) {
        const pub = p.getTrackPublication(Track.Source.Camera);
        if (pub?.track) return pub.track;
      }
      return null;
    };

    return {
      provider: "livekit",
      async setMicEnabled(enabled) {
        for (const pub of room.localParticipant.audioTrackPublications.values()) {
          if (enabled) await pub.unmute();
          else await pub.mute();
        }
        emit("connected");
      },
      async setCameraEnabled(enabled) {
        await room.localParticipant.setCameraEnabled(enabled);
        emit("connected");
      },
      async switchCamera() {
        facingUser = !facingUser;
        await room.localParticipant.setCameraEnabled(false);
        await room.localParticipant.setCameraEnabled(true, { facingMode: facingUser ? "user" : "environment" });
        emit("connected");
      },
      async replaceAudioTrack(track) {
        for (const pub of room.localParticipant.audioTrackPublications.values()) {
          if (pub.track) await room.localParticipant.unpublishTrack(pub.track);
        }
        await room.localParticipant.publishTrack(new LocalAudioTrack(track), { dtx: true, red: true });
      },
      attachLocalVideo(el) {
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (el && pub?.track) pub.track.attach(el);
      },
      attachRemoteMedia(el) {
        const track = firstRemoteVideo();
        if (el && track) track.attach(el);
      },
      async disconnect() {
        await room.disconnect();
        emit("disconnected");
      },
    };
  },
};

export function getCallProvider(configured: boolean): CallProvider {
  return configured ? liveKitProvider : unconfiguredProvider;
}
