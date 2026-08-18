import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /home hanya dipertahankan sebagai alias deep link lama. Redirect dilakukan
 * di beforeLoad supaya tidak ada layar "Membuka beranda…" yang berkedip.
 */
export const Route = createFileRoute("/home")({
  beforeLoad: () => {
    throw redirect({ to: "/chat", replace: true });
  },
});
