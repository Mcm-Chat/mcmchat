import { Mic, MicOff, PhoneOff, RefreshCcw, UserPlus, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
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
      "size-14 rounded-full border border-white/20",
      active ? "bg-white text-navy hover:bg-white/90" : "bg-white/15 text-white hover:bg-white/25",
    );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3 justify-items-center">
        <div className="flex flex-col items-center gap-1.5">
          <Button size="icon" className={btn(state.muted)} aria-label="Bisukan mikrofon" onClick={() => onToggle("muted")}>
            {state.muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
          </Button>
          <span className="text-[10px] text-white/70">{state.muted ? "Suara mati" : "Mikrofon"}</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(!state.cameraOn)}
            aria-label="Nyalakan kamera"
            onClick={() => onToggle("cameraOn")}
            disabled={kind === "audio"}
          >
            {state.cameraOn ? <Video className="size-6" /> : <VideoOff className="size-6" />}
          </Button>
          <span className="text-[10px] text-white/70">Kamera</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button size="icon" className={btn(state.speakerOn)} aria-label="Pengeras suara" onClick={() => onToggle("speakerOn")}>
            {state.speakerOn ? <Volume2 className="size-6" /> : <VolumeX className="size-6" />}
          </Button>
          <span className="text-[10px] text-white/70">Speaker</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className={btn(false)}
            aria-label="Balik kamera"
            onClick={() => onToggle("frontCamera")}
            disabled={kind === "audio"}
          >
            <RefreshCcw className="size-6" />
          </Button>
          <span className="text-[10px] text-white/70">{state.frontCamera ? "Depan" : "Belakang"}</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-1.5">
          <Button size="icon" className={btn(false)} aria-label="Tambah peserta" onClick={onAddParticipant}>
            <UserPlus className="size-6" />
          </Button>
          <span className="text-[10px] text-white/70">Tambah</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Button
            size="icon"
            className="size-16 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            aria-label="Akhiri panggilan"
            onClick={onEnd}
          >
            <PhoneOff className="size-7" />
          </Button>
          <span className="text-[10px] text-white/70">Akhiri</span>
        </div>
      </div>
    </div>
  );
}
