import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, Signal } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { CallControls, type CallState } from "@/components/mcm/call-parts";
import { MCMAvatar } from "@/components/mcm/primitives";
import { durasi } from "@/lib/mcm/format";
import { callAdapter, type CallSession } from "@/lib/mcm/call-service";
import { uid, useMCM } from "@/lib/mcm/store";

const searchSchema = z.object({ kind: z.enum(["audio", "video"]).catch("audio") });

export const Route = createFileRoute("/call/$id")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Panggilan berlangsung — MCM" },
      { name: "description", content: "Layar panggilan MCM dengan kontrol mikrofon, kamera, speaker, dan tambah peserta." },
      { property: "og:title", content: "Panggilan berlangsung — MCM" },
      { property: "og:description", content: "Kontrol panggilan suara dan video MCM." },
    ],
  }),
  component: CallScreen,
});

function CallScreen() {
  const { id } = Route.useParams();
  const { kind } = Route.useSearch();
  const { state, update } = useMCM();
  const navigate = useNavigate();
  const contact = state.contacts.find((c) => c.id === id);
  const [phase, setPhase] = useState<"memanggil" | "berlangsung">("memanggil");
  const [seconds, setSeconds] = useState(0);
  const [controls, setControls] = useState<CallState>({ muted: false, cameraOn: kind === "video", speakerOn: true, frontCamera: true });
  const session = useRef<CallSession | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const connect = setTimeout(async () => {
      session.current = await callAdapter.start(id, kind);
      setPhase("berlangsung");
      timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    }, 2200);
    return () => {
      clearTimeout(connect);
      if (timer) clearInterval(timer);
    };
  }, [id, kind]);

  const end = () => {
    update((d) => {
      d.calls.unshift({
        id: uid("cl"),
        contactId: id,
        contactName: contact?.name ?? "Pengguna MCM",
        kind,
        direction: "out",
        missed: phase === "memanggil",
        at: new Date().toISOString(),
        durationSec: seconds,
      });
      return d;
    });
    toast.success(phase === "memanggil" ? "Panggilan dibatalkan" : `Panggilan berakhir • ${durasi(seconds)}`);
    navigate({ to: "/calls" });
  };

  return (
    <div className="app-gradient flex min-h-screen flex-col items-center justify-between px-6 py-10 text-navy-foreground">
      <div className="flex flex-col items-center gap-3 pt-8">
        <MCMAvatar initials={contact?.initials ?? "MC"} color={contact?.avatarColor ?? "from-slate-500 to-slate-700"} size="xl" />
        <h1 className="text-2xl font-semibold">{contact?.name ?? "Pengguna MCM"}</h1>
        <p className="flex items-center gap-1.5 text-sm text-navy-foreground/70">
          {phase === "memanggil" ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Memanggil…
            </>
          ) : (
            <>
              <Signal className="size-4" /> {durasi(seconds)} • kualitas baik
            </>
          )}
        </p>
        {kind === "video" && (
          <div className="mt-4 flex h-40 w-56 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-xs text-navy-foreground/70">
            {controls.cameraOn ? `Pratinjau kamera ${controls.frontCamera ? "depan" : "belakang"} (simulasi)` : "Kamera dimatikan"}
          </div>
        )}
      </div>

      <div className="w-full max-w-sm space-y-6">
        <CallControls
          state={controls}
          kind={kind}
          onToggle={(key) => setControls((p) => ({ ...p, [key]: !p[key] }))}
          onAddParticipant={() => toast.info("Panggilan grup tersedia setelah integrasi WebRTC")}
          onEnd={end}
        />
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-navy-foreground/60">
          <ShieldCheck className="size-3.5" /> Mode simulasi • adapter: {callAdapter.name}
        </p>
      </div>
    </div>
  );
}
