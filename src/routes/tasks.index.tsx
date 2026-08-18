import { createFileRoute, redirect } from "@tanstack/react-router";

/** Tugas kini menjadi segmen hub Bisnis; satu lompatan langsung, tanpa layar antara. */
export const Route = createFileRoute("/tasks/")({
  beforeLoad: () => {
    throw redirect({ to: "/business/tugas", replace: true });
  },
});
