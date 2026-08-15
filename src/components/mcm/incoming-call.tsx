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
import { CallStatusLive } from "@/components/mcm/call-status-live";
import { useAuth } from "@/lib/auth";
import { fetchProfileCard } from "@/lib/api/profiles";
import { supabase } from "@/integrations/supabase/client";
import {
  declineCall,
  listRingingCalls,
  ringRemainingMs,
  subscribeCall,
  subscribeIncomingCalls,
  type CallRow,
} from "@/lib/api/calls";
import { onConnectionChange } from "@/lib/realtime/connection";
import { playTone } from "@/lib/calls/tones";
import { useModalA11y } from "@/lib/a11y/use-modal-a11y";

type Incoming = { call: CallRow; name: string; color: string };

export function IncomingCallListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  /** Alasan banner tertutup, diumumkan lewat aria-live setelah fokus pulih. */
  const [closedNotice, setClosedNotice] = useState("");
  /** Elemen pemicu terakhir sebelum banner muncul (untuk pemulihan fokus). */
  const triggerRef = useRef<HTMLElement | null>(null);
  // Banner panggilan masuk diperlakukan sebagai modal: fokus dikunci di dalam,
  // dan saat ditutup (jawab/tolak) fokus kembali ke elemen sebelumnya.
  // Escape sengaja tidak menolak panggilan agar tidak ada penolakan tak sengaja.
  const bannerRef = useModalA11y<HTMLDivElement>({
    onClose: () => undefined,
    active: Boolean(incoming),
    closeOnEscape: false,
    fallbackFocus: () => triggerRef.current,
  });

  // Simpan pemicu sebelum banner mengambil alih fokus, supaya penutupan karena
  // timeout atau perubahan status tetap bisa mengembalikan fokus ke sana.
  useEffect(() => {
    if (!incoming) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && !el.closest("[data-incoming-call]")) triggerRef.current = el;
  }, [incoming?.call.id]);

  /** Tutup banner + umumkan alasannya; pemulihan fokus ditangani useModalA11y. */
  const closeBanner = (notice: string) => {
    setIncoming(null);
    setClosedNotice(notice);
  };

  // Timeout dering: banner tidak boleh menggantung setelah batas dering habis.
  const ringingCall = incoming?.call ?? null;
  useEffect(() => {
    if (!ringingCall) return;
    const remaining = ringRemainingMs(ringingCall.created_at);
    if (remaining <= 0) {
      closeBanner("Panggilan masuk tak terjawab.");
      return;
    }
    const timer = window.setTimeout(
      () => closeBanner("Panggilan masuk tak terjawab."),
      remaining,
    );
    return () => window.clearTimeout(timer);
  }, [ringingCall?.id, ringingCall?.created_at]);

  // Perubahan status dari server (dibatalkan pemanggil, dijawab di perangkat
  // lain, gagal) juga menutup banner dengan alasan yang jelas.
  useEffect(() => {
    if (!ringingCall) return;
    return subscribeCall(ringingCall.id, (row) => {
      if (row.status === "ringing") return;
      const notice =
        row.status === "missed"
          ? "Panggilan masuk tak terjawab."
          : row.status === "declined"
            ? "Panggilan masuk ditolak."
            : row.status === "failed"
              ? "Panggilan masuk gagal."
              : "Panggilan masuk berakhir.";
      closeBanner(notice);
    });
  }, [ringingCall?.id]);

  // Pemulihan: event INSERT bisa terlewat saat aplikasi di latar belakang atau
  // realtime sedang putus. Saat kembali ke depan / tersambung ulang kita baca
  // ulang panggilan yang masih berdering, lalu de-dup dengan state saat ini.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    const recover = () => {
      void listRingingCalls(uid)
        .then((rows) => {
          const row = rows[0];
          if (!row) return;
          setIncoming((cur) =>
            cur?.call.id === row.id
              ? cur
              : { call: row, name: "Pengguna MCM", color: "from-slate-500 to-slate-700" },
          );
          void fetchProfileCard(row.initiator_id)
            .catch(() => null)
            .then((data) =>
              setIncoming((cur) =>
                cur?.call.id === row.id
                  ? {
                      ...cur,
                      name: data?.display_name ?? cur.name,
                      color: data?.avatar_color ?? cur.color,
                    }
                  : cur,
              ),
            );
        })
        .catch(() => undefined);
    };
    recover();
    const onVisible = () => {
      if (document.visibilityState === "visible") recover();
    };
    document.addEventListener("visibilitychange", onVisible);
    const offConn = onConnectionChange((s) => {
      if (s === "online") recover();
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      offConn();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    return subscribeIncomingCalls(user.id, (call) => {
      void fetchProfileCard(call.initiator_id)
        .catch(() => null)
        .then((data) =>
          setIncoming((cur) =>
            cur?.call.id === call.id
              ? cur
              : {
                  call,
                  name: data?.display_name ?? "Pengguna MCM",
                  color: data?.avatar_color ?? "from-slate-500 to-slate-700",
                },
          ),
        );
    });
  }, [user?.id]);

  // Layar panggilan sudah menampilkan UI-nya sendiri.
  useEffect(() => {
    if (incoming && pathname.startsWith(`/call/${incoming.call.id}`)) setIncoming(null);
  }, [pathname, incoming]);

  // Dering + getar selama banner panggilan masuk tampil.
  const ringingId = incoming?.call.id ?? null;
  useEffect(() => {
    if (!ringingId) return;
    const handle = playTone("ringtone");
    return () => handle.stop();
  }, [ringingId]);

  if (!incoming) {
    return (
      <p role="status" aria-live="polite" className="sr-only">
        {closedNotice}
      </p>
    );
  }
  const isVideo = incoming.call.kind === "video";

  return (
    <div
      ref={bannerRef}
      data-incoming-call=""
      role="dialog"
      aria-modal="true"
      aria-label={`${isVideo ? "Panggilan video" : "Panggilan suara"} masuk dari ${incoming.name}`}
      tabIndex={-1}
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 rounded-2xl border border-white/15 bg-navy/95 p-4 text-navy-foreground shadow-xl outline-none backdrop-blur"
    >
      <CallStatusLive
        assertive
        phase="incoming"
        kind={isVideo ? "video" : "audio"}
        name={incoming.name}
      />
      <div className="flex items-center gap-3">
        <MCMAvatar initials={incoming.name.slice(0, 2).toUpperCase()} color={incoming.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{incoming.name}</p>
          <p className="flex items-center gap-1 text-xs text-navy-foreground/70">
            {isVideo ? <Video className="size-3.5" /> : <Phone className="size-3.5" />}
            {isVideo ? "Panggilan video masuk" : "Panggilan suara masuk"}
          </p>
        </div>
        {/* Urutan Tab: Jawab lebih dulu (aksi utama), Tolak berikutnya —
            tata letak visual tetap Tolak di kiri lewat utilitas order. */}
        <Button
          size="icon"
          aria-label="Jawab panggilan"
          className="order-2 size-11 rounded-full bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-2 focus-visible:ring-white"
          onClick={() => {
            const id = incoming.call.id;
            closeBanner("");
            void navigate({ to: "/call/$id", params: { id } });
          }}
        >
          <Phone className="size-5" aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          aria-label="Tolak panggilan"
          className="order-1 size-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-white"
          onClick={() => {
            const id = incoming.call.id;
            closeBanner("Panggilan masuk ditolak.");
            void declineCall(id).catch(() => undefined);
          }}
        >
          <PhoneOff className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
