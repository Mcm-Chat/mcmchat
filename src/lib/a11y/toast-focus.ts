/**
 * Fokus otomatis ke toast penting (error/warning, atau yang ditandai
 * `data-important`). Toast biasa (sukses/info) tidak mencuri fokus.
 *
 * Perilaku:
 * - toast penting dibuat fokusabel (`tabindex="-1"`, `role="alert"`) lalu difokuskan
 *   agar pembaca layar & pengguna keyboard langsung berada di pesan tersebut;
 * - fokus sebelumnya disimpan dan dikembalikan saat toast ditutup, supaya
 *   pengguna tidak kehilangan konteks;
 * - dilewati bila pengguna sedang mengetik di input/textarea, agar tidak
 *   memutus alur pengisian form.
 */

const IMPORTANT_TYPES = new Set(["error", "warning"]);

function isImportantToast(el: HTMLElement): boolean {
  if (el.dataset["important"] === "true") return true;
  const type = el.getAttribute("data-type") ?? "";
  return IMPORTANT_TYPES.has(type);
}

function isTyping(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || active.isContentEditable;
}

function focusToast(toast: HTMLElement) {
  if (toast.dataset["a11yFocused"] === "true") return;
  toast.dataset["a11yFocused"] = "true";
  if (isTyping()) return;

  const previous = document.activeElement as HTMLElement | null;
  if (!toast.hasAttribute("tabindex")) toast.setAttribute("tabindex", "-1");
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "assertive");
  toast.focus({ preventScroll: true });

  // Kembalikan fokus ke elemen asal ketika toast hilang dari DOM.
  const restore = new MutationObserver(() => {
    if (toast.isConnected) return;
    restore.disconnect();
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
  });
  const parent = toast.parentElement;
  if (parent) restore.observe(parent, { childList: true, subtree: true });
}

function scan(root: ParentNode) {
  const nodes = root.querySelectorAll<HTMLElement>("[data-sonner-toast]");
  nodes.forEach((node) => {
    if (isImportantToast(node)) focusToast(node);
  });
}

/** Dipasang sekali di root; mengembalikan fungsi pelepas observer. */
export function installImportantToastFocus(): () => void {
  if (typeof document === "undefined") return () => {};

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches("[data-sonner-toast]") && isImportantToast(node)) focusToast(node);
        else scan(node);
      });
      if (record.type === "attributes" && record.target instanceof HTMLElement) {
        const el = record.target;
        if (el.matches("[data-sonner-toast]") && isImportantToast(el)) focusToast(el);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-type", "data-important"],
  });
  scan(document.body);

  return () => observer.disconnect();
}
