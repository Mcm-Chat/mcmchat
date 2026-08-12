/**
 * Pendengar panggilan masuk global.
 *
 * Dipasang sekali di root sehingga panggilan masuk muncul di layar mana pun.
 * Sumbernya adalah Realtime pada tabel `calls` (RLS memastikan hanya peserta
 * yang menerima), bukan simulasi lokal.
 */
import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MCMAvatar } from "@/components/mcm/primitives";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { declineCall, subscribeIncomingCalls, type CallRow } from "@/lib/api/calls";

type Incoming = { call: CallRow; name: string; color: string };

export function IncomingCallListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [incoming, setIncoming] = useState<Incoming | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    return subscribeIncomingCalls(user.id, (call) => {
      void supabase
        .from("profiles")
        .select("display_name, avatar_color")
        .eq("id", call.initiator_id)
        .maybeSingle()
        .then(({ data }) =>
          setIncoming({
            call,
            name: data?.display_name ?? "Pengguna MCM",
            color: data?.avatar_color ?? "from-slate-500 to-slate-700",
          }),
        );
    });
  }, [user?.id]);

  // Layar panggilan sudah menampilkan UI-nya sendiri.
  useEffect(() => {
    if (incoming && pathname.startsWith(`/call/${incoming.call.id}`)) setIncoming(null);
  }, [pathname, incoming]);

  if (!incoming) return null;
  const isVideo = incoming.call.kind === "video";

  return (
    <div className="fixed inset-x-3 top-3 z-50 rounded-2xl border border-white/15 bg-navy/95 p-4 text-navy-foreground shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        <MCMAvatar initials={incoming.name.slice(0, 2).toUpperCase()} color={incoming.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{incoming.name}</p>
          <p className="flex items-center gap-1 text-xs text-navy-foreground/70">
            {isVideo ? <Video className="size-3.5" /> : <Phone className="size-3.5" />}
            {isVideo ? "Panggilan video masuk" : "Panggilan suara masuk"}
          </p>
        </div>
        <Button
          size="icon"
          aria-label="Tolak panggilan"
          className="size-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => {
            const id = incoming.call.id;
            setIncoming(null);
            void declineCall(id).catch(() => undefined);
          }}
        >
          <PhoneOff className="size-5" />
        </Button>
        <Button
          size="icon"
          aria-label="Jawab panggilan"
          className="size-11 rounded-full bg-success text-success-foreground hover:bg-success/90"
          onClick={() => {
            const id = incoming.call.id;
            setIncoming(null);
            void navigate({ to: "/call/$id", params: { id } });
          }}
        >
          <Phone className="size-5" />
        </Button>
      </div>
    </div>
  );
}
