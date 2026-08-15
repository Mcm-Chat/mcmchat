import { callStatusAnnouncement, type CallAnnouncementInput } from "@/lib/calls/call-announcement";

/**
 * Live region tersembunyi yang membacakan ringkasan status panggilan
 * (mulai, tersambung, terputus, gagal) ke pembaca layar.
 */
export function CallStatusLive({
  assertive = false,
  ...props
}: CallAnnouncementInput & { assertive?: boolean }) {
  const message = callStatusAnnouncement(props);
  return (
    <div
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label="Status panggilan"
      className="sr-only"
    >
      {message}
    </div>
  );
}
