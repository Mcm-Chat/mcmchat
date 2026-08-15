import { useEffect, useRef, useState } from "react";

/** Ucapan durasi ramah pembaca layar: "1 menit", "1 jam 5 menit". */
export function durationSpeech(sec: number) {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} jam ${m} menit` : `${h} jam`;
  return `${m} menit`;
}

/**
 * Mengumumkan durasi panggilan secara berkala (default tiap menit) lewat live
 * region sopan, agar detik berjalan tidak membanjiri pembaca layar.
 */
export function CallDurationLive({
  active,
  durationSec,
  intervalSec = 60,
}: {
  active: boolean;
  durationSec: number;
  intervalSec?: number;
}) {
  const [message, setMessage] = useState("");
  const lastStep = useRef(0);

  useEffect(() => {
    if (!active) {
      lastStep.current = 0;
      setMessage("");
      return;
    }
    const step = Math.floor(durationSec / intervalSec);
    if (step < 1 || step === lastStep.current) return;
    lastStep.current = step;
    setMessage(`Panggilan berjalan ${durationSpeech(step * intervalSec)}.`);
  }, [active, durationSec, intervalSec]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Durasi panggilan"
      className="sr-only"
    >
      {message}
    </div>
  );
}
