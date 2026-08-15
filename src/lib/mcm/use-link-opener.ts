import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { internalPathOf, openExternalLink } from "./open-link";

/**
 * Handler klik link: URL internal dinavigasi in-app (tanpa reload),
 * URL eksternal dibuka di browser aman (in-app browser di native).
 * `tel:`/`mailto:` dibiarkan ditangani sistem.
 */
export function useLinkOpener() {
  const navigate = useNavigate();
  return useCallback(
    (href: string, e?: { preventDefault: () => void }) => {
      if (!/^https?:/i.test(href) && !href.startsWith("/")) return;
      e?.preventDefault();
      const path = internalPathOf(href);
      if (path) {
        void navigate({ to: path, replace: false });
        return;
      }
      void openExternalLink(href);
    },
    [navigate],
  );
}
