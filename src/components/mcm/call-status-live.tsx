import { useEffect, useRef, useState } from "react";
import {
  callStatusAnnouncement,
  isUrgentPhase,
  type CallAnnouncementInput,
} from "@/lib/calls/call-announcement";

/**
 * Live region tersembunyi yang membacakan status panggilan (berdering,
 * menyambungkan, tersambung, sinyal lemah, terputus, gagal) ke pembaca layar.
 *
 * Fase mendesak (panggilan masuk / gagal) diumumkan assertive; sisanya polite.
 * Teks hanya ditulis ulang saat isinya berubah, dan pengumuman ditunda satu
 * frame setelah region kosong agar pembaca layar selalu mendeteksi mutasi —
 * termasuk saat dua fase menghasilkan kalimat yang mirip.
 */
export function CallStatusLive({
  assertive,
  ...props
}: CallAnnouncementInput & { assertive?: boolean }) {
  const message = callStatusAnnouncement(props);
  const urgent = assertive ?? isUrgentPhase(props.phase);
  const [spoken, setSpoken] = useState("");
  const last = useRef("");

  useEffect(() => {
    if (message === last.current) return;
    last.current = message;
    setSpoken("");
    const raf = requestAnimationFrame(() => setSpoken(message));
    return () => cancelAnimationFrame(raf);
  }, [message]);

  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label="Status panggilan"
      className="sr-only"
    >
      {spoken}
    </div>
  );
}
