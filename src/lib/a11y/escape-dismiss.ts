import { toast } from "sonner";

/**
 * Pintasan Escape global untuk menutup notifikasi:
 * - banner yang bisa ditutup mendaftar ke stack (yang terakhir muncul ditutup lebih dulu);
 * - bila tidak ada banner, Escape menutup semua toast yang sedang tampil.
 *
 * Escape diabaikan saat ada dialog/sheet terbuka (Radix menangani sendiri).
 */

type Dismiss = () => void;

const stack: Dismiss[] = [];

export function registerDismissible(fn: Dismiss): () => void {
  stack.push(fn);
  return () => {
    const i = stack.indexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]',
    ),
  );
}

function isTyping(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || active.isContentEditable;
}

export function installEscapeDismiss(): () => void {
  if (typeof window === "undefined") return () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (hasOpenOverlay()) return;

    const last = stack[stack.length - 1];
    if (last) {
      event.preventDefault();
      last();
      return;
    }

    const toasts = document.querySelectorAll("[data-sonner-toast]");
    if (toasts.length === 0) return;
    if (isTyping() && !(document.activeElement as HTMLElement)?.closest("[data-sonner-toast]")) {
      return;
    }
    event.preventDefault();
    toast.dismiss();
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
