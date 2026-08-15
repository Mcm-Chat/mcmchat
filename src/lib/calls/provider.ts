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
  /** Kualitas jaringan lokal (dari SFU), untuk indikator sinyal di layar. */
  quality?: "excellent" | "good" | "poor" | "unknown";
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

/** Perangkat input yang bisa dipilih pengguna saat panggilan berjalan. */
export type MediaDeviceOption = { deviceId: string; label: string };
export type CallDevices = { mics: MediaDeviceOption[]; cameras: MediaDeviceOption[] };

export interface CallSessionHandle {
  readonly provider: string;
  readonly speakerCapability: SpeakerCapability;
  /** Mengembalikan status speaker sesungguhnya; `null` bila tidak didukung. */
  setSpeaker(on: boolean): Promise<boolean | null>;
  setMicEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  switchCamera(): Promise<void>;
  /** Ganti kamera aktif ke perangkat tertentu tanpa memutus panggilan. */
  setVideoInput(deviceId: string): Promise<boolean>;
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
    const { Room, RoomEvent, Track, VideoPresets } = lk;
    // Profil hemat untuk ponsel kelas menengah Indonesia: kamera 360p 24fps,
    // simulcast agar SFU bisa menurunkan layer saat jaringan jelek, dan
    // dynacast/adaptiveStream supaya track yang tidak terlihat berhenti dikirim.
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
      stopLocalTrackOnUnpublish: true,
      // Pemrosesan bawaan browser tetap menyala: tanpa ini panggilan di ponsel
      // terdengar bergema dan berisik saat memakai speaker.
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      videoCaptureDefaults: {
        resolution: opts.kind === "video" ? VideoPresets.h360.resolution : VideoPresets.h180.resolution,
        facingMode: "user",
      },
      publishDefaults: {
        simulcast: true,
        videoCodec: "vp8",
        dtx: true,
        red: true,
        videoEncoding: VideoPresets.h360.encoding,
        // Layer bawah 180p supaya SFU punya ruang turun saat sinyal jelek,
        // bukan langsung membekukan gambar.
        videoSimulcastLayers: [VideoPresets.h180],
        degradationPreference: "maintain-framerate",
      },
    });

    let facingUser = true;
    let remoteVideoEl: HTMLVideoElement | null = null;
    let localVideoEl: HTMLVideoElement | null = null;
    let closing = false;
    let audioBlocked = false;
    const audioEls = new Map<string, HTMLAudioElement>();
    let speakerSinkId: string | null = null;
    let quality: NonNullable<ProviderState["quality"]> = "unknown";
    /** Sidik state terakhir — mencegah render ulang UI untuk state identik. */
    let lastEmit = "";

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
    const emit = (status: ProviderStatus, reason?: string, unexpected?: boolean) => {
      const state: ProviderState = {
        status,
        remotes: remotes(),
        audioBlocked,
        quality,
        ...(reason ? { reason } : {}),
        ...(unexpected ? { unexpected: true } : {}),
      };
      const key = JSON.stringify(state);
      if (key === lastEmit) return;
      lastEmit = key;
      opts.onState(state);
    };

    /** Attach idempotent: elemen yang sudah terpasang tidak dipasang ulang. */
    const attachOnce = (
      track: { attach: (el: HTMLVideoElement) => unknown; attachedElements?: HTMLMediaElement[] },
      el: HTMLVideoElement,
    ) => {
      if (track.attachedElements?.includes(el)) return;
      track.attach(el);
    };
    /** Pasang track kamera lokal ke elemen yang sudah/baru saja mount. */
    const attachLocal = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localVideoEl && pub?.track) attachOnce(pub.track, localVideoEl);
    };
    const attachRemote = () => {
      if (!remoteVideoEl) return;
      for (const p of room.remoteParticipants.values()) {
        const pub = p.getTrackPublication(Track.Source.Camera);
        if (pub?.track) {
          attachOnce(pub.track, remoteVideoEl);
          return;
        }
      }
    };
    /** Status nyata room dipakai apa adanya, bukan selalu "connected". */
    const liveStatus = (): ProviderStatus =>
      room.state === "connected"
        ? "connected"
        : room.state === "reconnecting"
          ? "reconnecting"
          : room.state === "connecting"
            ? "connecting"
            : "disconnected";
    const sync = () => emit(liveStatus());

    room
      .on(RoomEvent.Connected, () => emit("connected"))
      .on(RoomEvent.Reconnecting, () => emit("reconnecting", "Menyambung ulang…"))
      .on(RoomEvent.Reconnected, () => emit("connected"))
      // Putus normal (hangup) tidak boleh memunculkan error; putus tak terduga bisa dipulihkan.
      .on(RoomEvent.Disconnected, () =>
        closing ? emit("disconnected") : emit("failed", "Koneksi panggilan terputus", true),
      )
      .on(RoomEvent.LocalTrackPublished, () => {
        attachLocal();
        sync();
      })
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.ActiveSpeakersChanged, sync)
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
        if (p?.identity !== room.localParticipant.identity) return;
        quality =
          q === "excellent" ? "excellent" : q === "good" ? "good" : q === "poor" ? "poor" : "unknown";
        sync();
      })
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
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
        if (track.kind === Track.Kind.Video && remoteVideoEl) attachOnce(track, remoteVideoEl);
        else if (track.kind === Track.Kind.Video) attachRemote();
        sync();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) el.remove();
        if (track.kind === Track.Kind.Audio) {
          for (const [k, v] of audioEls) if (!v.isConnected) audioEls.delete(k);
        }
        sync();
      });

    emit("connecting");
    // Prewarm koneksi (DNS/TLS/ICE) supaya jeda "Menyambungkan…" jauh lebih
    // pendek di jaringan seluler.
    await room.prepareConnection(opts.url, opts.token).catch(() => undefined);
    await room.connect(opts.url, opts.token, { autoSubscribe: true, maxRetries: 5 });

    if (opts.audioTrack) {
      await room.localParticipant.publishTrack(opts.audioTrack, { dtx: true, red: true });
    } else {
      await room.localParticipant.setMicrophoneEnabled(true);
    }
    if (opts.kind === "video") {
      // Kamera gagal (izin ditolak/perangkat sibuk) tidak boleh menggagalkan
      // panggilan — audio tetap jalan dan pengguna bisa mencoba lagi.
      try {
        await room.localParticipant.setCameraEnabled(true);
        attachLocal();
      } catch {
        emit("connected", "Kamera tidak dapat dinyalakan — panggilan lanjut tanpa video");
      }
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
          sync();
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
        sync();
      },
      async setCameraEnabled(enabled) {
        try {
          await room.localParticipant.setCameraEnabled(enabled);
          if (enabled) attachLocal();
          sync();
        } catch {
          emit(liveStatus(), "Kamera tidak dapat dinyalakan");
        }
      },
      async switchCamera() {
        facingUser = !facingUser;
        const facingMode = facingUser ? "user" : "environment";
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const local = pub?.track as { restartTrack?: (o: unknown) => Promise<void> } | undefined;
        try {
          // Restart track jauh lebih ringan daripada unpublish+publish ulang:
          // tidak ada renegosiasi, video tidak hitam berkedip.
          if (local?.restartTrack) await local.restartTrack({ facingMode });
          else {
            await room.localParticipant.setCameraEnabled(false);
            await room.localParticipant.setCameraEnabled(true, { facingMode });
          }
          attachLocal();
        } catch {
          facingUser = !facingUser;
          emit(liveStatus(), "Kamera tidak bisa dibalik di perangkat ini");
          return;
        }
        sync();
      },
      async setVideoInput(deviceId) {
        try {
          await room.switchActiveDevice("videoinput", deviceId, true);
          attachLocal();
          sync();
          return true;
        } catch {
          emit(liveStatus(), "Kamera itu tidak bisa dipakai saat ini");
          return false;
        }
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
