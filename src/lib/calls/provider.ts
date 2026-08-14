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
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "failed" | "unconfigured";

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
  /** Autoplay audio diblokir browser — UI menampilkan tombol "Aktifkan suara". */
  audioBlocked?: boolean;
  /** Terputus tak terduga (bukan hangup normal) — dapat dipulihkan. */
  unexpected?: boolean;
};

export type ConnectOptions = {
  url: string;
  token: string;
  kind: CallKind;
  /** Track audio hasil VoicePipeline (sudah diproses) atau mic mentah. */
  audioTrack: MediaStreamTrack | null;
  onState: (s: ProviderState) => void;
};

/**
 * Kemampuan pemilihan keluaran audio.
 * - `sinkId`: browser mengizinkan memilih perangkat keluaran (setSinkId).
 * - `system`: rute speaker/earpiece ditentukan sistem — tombol speaker
 *   TIDAK ditampilkan agar tidak menjadi tombol palsu.
 */
export type SpeakerCapability = "sinkId" | "system";

export interface CallSessionHandle {
  readonly provider: string;
  readonly speakerCapability: SpeakerCapability;
  /** Mengembalikan status speaker sesungguhnya; `null` bila tidak didukung. */
  setSpeaker(on: boolean): Promise<boolean | null>;
  setMicEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  switchCamera(): Promise<void>;
  /** Ganti track audio keluar tanpa renegosiasi penuh (mis. efek suara on/off). */
  replaceAudioTrack(track: MediaStreamTrack): Promise<void>;
  attachLocalVideo(el: HTMLVideoElement | null): void;
  attachRemoteMedia(el: HTMLVideoElement | null): void;
  /** Buka blokir autoplay audio (harus dipicu gestur pengguna). */
  startAudio(): Promise<boolean>;
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
    throw new Error(
      "Penyedia panggilan belum terhubung. Hubungi admin untuk mengaktifkan kredensial LiveKit.",
    );
  },
};

/** Implementasi LiveKit; modul SDK dimuat dinamis agar aman untuk SSR. */
export const liveKitProvider: CallProvider = {
  name: "livekit",
  isConfigured: () => true,
  async connect(opts: ConnectOptions): Promise<CallSessionHandle> {
    const lk = await import("livekit-client");
    const { Room, RoomEvent, Track } = lk;
    const room = new Room({ adaptiveStream: true, dynacast: true });

    let facingUser = true;
    let remoteVideoEl: HTMLVideoElement | null = null;
    let localVideoEl: HTMLVideoElement | null = null;
    let closing = false;
    let audioBlocked = false;
    const audioEls = new Map<string, HTMLAudioElement>();
    let speakerSinkId: string | null = null;

    const canSetSink =
      typeof window !== "undefined" &&
      typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId ===
        "function";
    const speakerCapability: SpeakerCapability = canSetSink ? "sinkId" : "system";

    const applySink = async (el: HTMLAudioElement) => {
      if (!canSetSink || !speakerSinkId) return;
      try {
        await (el as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(
          speakerSinkId,
        );
      } catch {
        /* perangkat keluaran ditolak; biarkan default sistem */
      }
    };
    const remotes = (): RemoteInfo[] =>
      Array.from(room.remoteParticipants.values()).map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        speaking: p.isSpeaking,
        micEnabled: p.isMicrophoneEnabled,
        cameraEnabled: p.isCameraEnabled,
      }));
    const emit = (status: ProviderStatus, reason?: string, unexpected?: boolean) =>
      opts.onState({
        status,
        remotes: remotes(),
        audioBlocked,
        ...(reason ? { reason } : {}),
        ...(unexpected ? { unexpected: true } : {}),
      });

    /** Pasang track kamera lokal ke elemen yang sudah/baru saja mount. */
    const attachLocal = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localVideoEl && pub?.track) pub.track.attach(localVideoEl);
    };
    const attachRemote = () => {
      if (!remoteVideoEl) return;
      for (const p of room.remoteParticipants.values()) {
        const pub = p.getTrackPublication(Track.Source.Camera);
        if (pub?.track) {
          pub.track.attach(remoteVideoEl);
          return;
        }
      }
    };

    room
      .on(RoomEvent.Connected, () => emit("connected"))
      .on(RoomEvent.Reconnecting, () => emit("reconnecting", "Menyambung ulang…"))
      .on(RoomEvent.Reconnected, () => emit("connected"))
      // Putus normal (hangup) tidak boleh memunculkan error; putus tak terduga bisa dipulihkan.
      .on(RoomEvent.Disconnected, () =>
        closing
          ? emit("disconnected")
          : emit("failed", "Koneksi panggilan terputus", true),
      )
      .on(RoomEvent.LocalTrackPublished, () => {
        attachLocal();
        emit("connected");
      })
      .on(RoomEvent.ParticipantConnected, () => emit("connected"))
      .on(RoomEvent.ParticipantDisconnected, () => emit("connected"))
      .on(RoomEvent.ActiveSpeakersChanged, () => emit("connected"))
      .on(RoomEvent.TrackMuted, () => emit("connected"))
      .on(RoomEvent.TrackUnmuted, () => emit("connected"))
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          // Audio lawan bicara diputar apa adanya; tidak pernah diproses efek.
          const el = track.attach() as HTMLAudioElement;
          el.autoplay = true;
          audioEls.set(track.sid ?? el.id ?? String(audioEls.size), el);
          void applySink(el);
          void el.play().catch(() => {
            audioBlocked = true;
            emit("connected", "Suara diblokir browser — ketuk \u201cAktifkan suara\u201d");
          });
        }
        if (track.kind === Track.Kind.Video && remoteVideoEl) track.attach(remoteVideoEl);
        else if (track.kind === Track.Kind.Video) attachRemote();
        emit("connected");
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) el.remove();
        if (track.kind === Track.Kind.Audio) {
          for (const [k, v] of audioEls) if (!v.isConnected) audioEls.delete(k);
        }
        emit("connected");
      });

    emit("connecting");
    await room.connect(opts.url, opts.token);

    if (opts.audioTrack) {
      await room.localParticipant.publishTrack(opts.audioTrack, { dtx: true, red: true });
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }
    if (opts.kind === "video") {
      await room.localParticipant.setCameraEnabled(true);
      attachLocal();
    }
    if (!room.canPlaybackAudio) audioBlocked = true;
    emit("connected");

    return {
      provider: "livekit",
      async startAudio() {
        try {
          await room.startAudio();
          for (const el of audioEls.values()) await el.play().catch(() => undefined);
          audioBlocked = !room.canPlaybackAudio;
          emit("connected");
          return !audioBlocked;
        } catch {
          emit("connected", "Browser masih memblokir suara");
          return false;
        }
      },
      async setMicEnabled(enabled) {
        for (const pub of room.localParticipant.audioTrackPublications.values()) {
          if (enabled) await pub.unmute();
          else await pub.mute();
        }
        emit("connected");
      },
      async setCameraEnabled(enabled) {
        await room.localParticipant.setCameraEnabled(enabled);
        if (enabled) attachLocal();
        emit("connected");
      },
      async switchCamera() {
        facingUser = !facingUser;
        await room.localParticipant.setCameraEnabled(false);
        await room.localParticipant.setCameraEnabled(true, {
          facingMode: facingUser ? "user" : "environment",
        });
        attachLocal();
        emit("connected");
      },
      async replaceAudioTrack(track) {
        for (const pub of room.localParticipant.audioTrackPublications.values()) {
          if (pub.track?.mediaStreamTrack)
            await room.localParticipant.unpublishTrack(pub.track.mediaStreamTrack);
        }
        await room.localParticipant.publishTrack(track, { dtx: true, red: true });
      },
      attachLocalVideo(el) {
        localVideoEl = el;
        attachLocal();
      },
      speakerCapability,
      async setSpeaker(on) {
        if (!canSetSink) return null;
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const outputs = devices.filter((d) => d.kind === "audiooutput");
        if (outputs.length < 2) return null;
        const target =
          (on
            ? outputs.find((d) => /speaker|speakerphone/i.test(d.label))
            : outputs.find((d) => /earpiece|receiver|headset/i.test(d.label))) ??
          outputs.find((d) => d.deviceId === "default") ??
          outputs[0];
        if (!target) return null;
        speakerSinkId = target.deviceId;
        for (const el of audioEls.values()) await applySink(el);
        return on;
      },
      attachRemoteMedia(el) {
        remoteVideoEl = el;
        attachRemote();
      },
      async disconnect() {
        closing = true;
        for (const el of audioEls.values()) {
          el.pause();
          el.srcObject = null;
          el.remove();
        }
        audioEls.clear();
        remoteVideoEl = null;
        await room.disconnect();
        emit("disconnected");
      },
    };
  },
};

export function getCallProvider(configured: boolean): CallProvider {
  return configured ? liveKitProvider : unconfiguredProvider;
}
