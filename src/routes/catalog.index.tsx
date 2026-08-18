import { createFileRoute, redirect } from "@tanstack/react-router";

/** Katalog kini menjadi segmen hub Bisnis; satu lompatan langsung, tanpa layar antara. */
export const Route = createFileRoute("/catalog/")({
  beforeLoad: () => {
    throw redirect({ to: "/business", replace: true });
  },
});
