import {
  Mic,
  MicOff,
  PhoneOff,
  RefreshCcw,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CallState {
  muted: boolean;
  cameraOn: boolean;
  speakerOn: boolean;
  frontCamera: boolean;
}

export function CallControls({
  state,
  kind,
  onToggle,
  onAddParticipant,
  onEnd,
}: {
  state: CallState;
  kind: "audio" | "video";
  onToggle: (key: keyof CallState) => void;
  onAddParticipant: () => void;
  onEnd: () => void;
}) {
  const btn = (active: boolean) =>
    cn(
      "size-14 rounded-full border border-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy",
      active ? "bg-white text-navy hover:bg-white/90" : "bg-white/15 text-white hover:bg-white/25",
    );
  const videoDisabled = kind === "audio";
  return (
    <div
      className="space-y-5"
      role="toolbar"
      aria-label="Kontrol panggilan"
      aria-orientation="horizontal"
    >
      <div className="grid grid-cols-4 gap-3 justify-items-center">
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(state.muted)}
            aria-pressed={state.muted}
            aria-label={state.muted ? "Nyalakan mikrofon (saat ini dibisukan)" : "Bisukan mikrofon"}
            onClick={() => onToggle("muted")}
          >
            {state.muted ? (
              <MicOff className="size-6" aria-hidden="true" />
            ) : (
              <Mic className="size-6" aria-hidden="true" />
            )}
          </Button>
          <span aria-hidden="true" className="text-[10px] text-white/70">
            {state.muted ? "Suara mati" : "Mikrofon"}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(!state.cameraOn)}
            aria-pressed={state.cameraOn}
            aria-label={
              videoDisabled
                ? "Kamera tidak tersedia pada panggilan suara"
                : state.cameraOn
                  ? "Matikan kamera"
                  : "Nyalakan kamera"
            }
            onClick={() => onToggle("cameraOn")}
            disabled={videoDisabled}
          >
            {state.cameraOn ? (
              <Video className="size-6" aria-hidden="true" />
            ) : (
              <VideoOff className="size-6" aria-hidden="true" />
            )}
          </Button>
          <span aria-hidden="true" className="text-[10px] text-white/70">
            Kamera
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(state.speakerOn)}
            aria-pressed={state.speakerOn}
            aria-label={state.speakerOn ? "Matikan pengeras suara" : "Nyalakan pengeras suara"}
            onClick={() => onToggle("speakerOn")}
          >
            {state.speakerOn ? (
              <Volume2 className="size-6" aria-hidden="true" />
            ) : (
              <VolumeX className="size-6" aria-hidden="true" />
            )}
          </Button>
          <span aria-hidden="true" className="text-[10px] text-white/70">
            Speaker
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(false)}
            aria-label={
              videoDisabled
                ? "Balik kamera tidak tersedia pada panggilan suara"
                : state.frontCamera
                  ? "Balik ke kamera belakang (saat ini kamera depan)"
                  : "Balik ke kamera depan (saat ini kamera belakang)"
            }
            onClick={() => onToggle("frontCamera")}
            disabled={videoDisabled}
          >
            <RefreshCcw className="size-6" aria-hidden="true" />
          </Button>
          <span aria-hidden="true" className="text-[10px] text-white/70">
            {state.frontCamera ? "Depan" : "Belakang"}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(false)}
            aria-label="Tambah peserta ke panggilan"
            onClick={onAddParticipant}
          >
            <UserPlus className="size-6" aria-hidden="true" />
          </Button>
          <span aria-hidden="true" className="text-[10px] text-white/70">
            Tambah
          </span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className="size-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            aria-label="Akhiri panggilan"
            onClick={onEnd}
          >
            <PhoneOff className="size-7" aria-hidden="true" />
          </Button>
          <span aria-hidden="true" className="text-[10px] text-white/70">
            Akhiri
          </span>
        </div>
      </div>
    </div>
  );
}
