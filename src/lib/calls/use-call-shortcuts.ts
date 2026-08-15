/**
 * Pintasan keyboard kontrol panggilan.
 *
 * Aktif hanya saat panggilan hidup, diabaikan bila pengguna sedang mengetik,
 * memakai modifier (Ctrl/Alt/Meta), atau ada dialog/sheet terbuka —
 * sehingga tidak pernah bentrok dengan Radix atau form.
 */
import { useEffect, useRef, useState } from "react";

export type CallShortcutAction =
  "mute" | "camera" | "speaker" | "switchCamera" | "devices" | "hangup" | "answer" | "decline";

export const CALL_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "M", label: "Bisukan / nyalakan mikrofon" },
  { keys: "V", label: "Matikan / nyalakan kamera" },
  { keys: "S", label: "Pengeras suara" },
  { keys: "B", label: "Balik kamera depan/belakang" },
  { keys: "P", label: "Pilih perangkat mic & kamera" },
  { keys: "E", label: "Akhiri panggilan" },
  { keys: "A", label: "Jawab panggilan masuk" },
  { keys: "T", label: "Tolak panggilan masuk" },
  { keys: "?", label: "Tampilkan/sembunyikan daftar pintasan" },
];

const KEY_MAP: Record<string, CallShortcutAction> = {
  m: "mute",
  v: "camera",
  s: "speaker",
  b: "switchCamera",
  p: "devices",
  e: "hangup",
  a: "answer",
  t: "decline",
};

function blocked(): boolean {
  if (typeof document === "undefined") return true;
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    const tag = active.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || active.isContentEditable) {
      return true;
    }
  }
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ),
  );
}

export function useCallShortcuts(opts: {
  enabled: boolean;
  onAction: (action: CallShortcutAction) => void;
}) {
  const { enabled, onAction } = opts;
  const [helpOpen, setHelpOpen] = useState(false);
  /** Diumumkan lewat aria-live agar pengguna pembaca layar tahu aksi terjadi. */
  const [announcement, setAnnouncement] = useState("");
  const handler = useRef(onAction);
  handler.current = onAction;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (blocked()) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      const action = KEY_MAP[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      handler.current(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) setHelpOpen(false);
  }, [enabled]);

  return { helpOpen, setHelpOpen, announcement, announce: setAnnouncement };
}
