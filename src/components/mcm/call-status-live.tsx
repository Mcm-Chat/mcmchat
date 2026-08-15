import { callStatusAnnouncement, type CallAnnouncementInput } from "@/lib/calls/call-announcement";

/**
 * Live region tersembunyi yang membacakan ringkasan status panggilan
 * (mulai, tersambung, terputus, gagal) ke pembaca layar.
 */
export function CallStatusLive(props: CallAnnouncementInput) {
  const message = callStatusAnnouncement(props);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Status panggilan"
      className="sr-only"
    >
      {message}
    </div>
  );
}
